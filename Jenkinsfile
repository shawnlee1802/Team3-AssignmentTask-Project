pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
    }

    tools {
        nodejs 'NodeJS'
    }

    environment {
        DOCKER_IMAGE = 'assignment-tracker-node'
        PORT = '3000'
        DEPLOYMENT_STARTED = 'false'
        SESSION_SECRET = credentials('assignment-tracker-session-secret')
        MYSQL_ROOT_PASSWORD = credentials('assignment-tracker-mysql-root-password')
        MYSQL_APP_PASSWORD = credentials('assignment-tracker-mysql-app-password')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'npm ci'
                    } else {
                        bat 'npm ci'
                    }
                }
            }
        }

        stage('Test') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'npm test'
                    } else {
                        bat 'npm test'
                    }
                }
            }
        }

        stage('Validate Docker Compose') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'docker compose config > /dev/null'
                    } else {
                        bat '@docker compose config > NUL'
                    }
                }
            }
        }
    


        stage('Build Docker Image') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'docker build -t $DOCKER_IMAGE:$BUILD_NUMBER -t $DOCKER_IMAGE:latest .'
                    } else {
                        bat 'docker build -t %DOCKER_IMAGE%:%BUILD_NUMBER% -t %DOCKER_IMAGE%:latest .'
                    }
                }
            }
        }

        stage('Deploy Locally Using Docker Compose') {
            steps {
                script {
                    env.DEPLOYMENT_STARTED = 'true'

                    if (isUnix()) {
                        sh 'docker compose up -d --no-build'
                    } else {
                        bat 'docker compose up -d --no-build'
                    }
                }
            }
        }

        stage('Health Check') {
            steps {
                script {
                    if (isUnix()) {
                        sh '''
                            container_id="$(docker compose ps -q app)"
                            if [ -z "$container_id" ]; then
                                echo "Application container was not created."
                                exit 1
                            fi

                            attempt=1
                            while [ "$attempt" -le 30 ]; do
                                health_status="$(docker inspect --format='{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
                                echo "Health attempt $attempt: $health_status"

                                if [ "$health_status" = "healthy" ]; then
                                    exit 0
                                fi

                                if [ "$health_status" = "unhealthy" ]; then
                                    exit 1
                                fi

                                attempt=$((attempt + 1))
                                sleep 5
                            done

                            echo "Application did not become healthy before the timeout."
                            exit 1
                        '''

                        sh '''
                            node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(async (response) => { const body = await response.text(); console.log(body); if (!response.ok) process.exit(1); }).catch((error) => { console.error(error.message); process.exit(1); });"
                        '''
                    } else {
                        bat '''
                            @echo off
                            setlocal EnableExtensions EnableDelayedExpansion

                            set "CONTAINER_ID="
                            for /f "usebackq delims=" %%C in (`docker compose ps -q app`) do set "CONTAINER_ID=%%C"

                            if not defined CONTAINER_ID (
                                echo Application container was not created.
                                exit /b 1
                            )

                            for /L %%I in (1,1,30) do (
                                set "HEALTH_STATUS="
                                for /f "usebackq delims=" %%H in (`docker inspect --format="{{.State.Health.Status}}" "!CONTAINER_ID!" 2^>nul`) do set "HEALTH_STATUS=%%H"
                                echo Health attempt %%I: !HEALTH_STATUS!

                                if "!HEALTH_STATUS!"=="healthy" exit /b 0
                                if "!HEALTH_STATUS!"=="unhealthy" exit /b 1

                                powershell -NoProfile -Command "Start-Sleep -Seconds 5"
                            )

                            echo Application did not become healthy before the timeout.
                            exit /b 1
                        '''

                        bat '''
                            @echo off
                            node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(async (response) => { const body = await response.text(); console.log(body); if (!response.ok) process.exit(1); }).catch((error) => { console.error(error.message); process.exit(1); });"
                        '''
                    }
                }
            }
        }

        stage('Deploy to AWS EC2') {
            steps {
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: 'assignment-tracker-ec2-ssh',
                        keyFileVariable: 'EC2_SSH_KEY'
                    ),
                    string(
                        credentialsId: 'assignment-tracker-ec2-host',
                        variable: 'EC2_HOST'
                    )
                ]) {
                    script {
                        if (isUnix()) {
                            sh '''
                                ssh -i "$EC2_SSH_KEY" \
                                  -o BatchMode=yes \
                                  -o StrictHostKeyChecking=accept-new \
                                  "ubuntu@$EC2_HOST" \
                                  'cd /home/ubuntu/Team3-AssignmentTask-Project && git checkout main && git pull --ff-only origin main && bash scripts/deploy-ec2.sh'
                            '''
                        } else {
                            bat '''
                                @echo off
                                setlocal EnableExtensions EnableDelayedExpansion

                                set "RESTRICTED_KEY=%WORKSPACE%\\ec2-jenkins-key-%BUILD_NUMBER%.tmp"
                                set "SSH_EXIT_CODE=1"

                                for /f "delims=" %%U in ('whoami') do set "JENKINS_USER=%%U"
                                if not defined JENKINS_USER (
                                    echo Unable to detect the Jenkins service identity.
                                    set "SSH_EXIT_CODE=1"
                                    goto cleanup_key
                                )

                                copy /Y "%EC2_SSH_KEY%" "!RESTRICTED_KEY!" >NUL
                                if errorlevel 1 (
                                    set "SSH_EXIT_CODE=!ERRORLEVEL!"
                                    goto cleanup_key
                                )

                                icacls "!RESTRICTED_KEY!" /grant:r "!JENKINS_USER!:(F)" >NUL
                                if errorlevel 1 (
                                    set "SSH_EXIT_CODE=!ERRORLEVEL!"
                                    goto cleanup_key
                                )

                                icacls "!RESTRICTED_KEY!" /setowner "!JENKINS_USER!" >NUL
                                if errorlevel 1 (
                                    set "SSH_EXIT_CODE=!ERRORLEVEL!"
                                    goto cleanup_key
                                )

                                icacls "!RESTRICTED_KEY!" /inheritance:r >NUL
                                if errorlevel 1 (
                                    set "SSH_EXIT_CODE=!ERRORLEVEL!"
                                    goto cleanup_key
                                )

                                ssh -i "!RESTRICTED_KEY!" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "ubuntu@%EC2_HOST%" "cd /home/ubuntu/Team3-AssignmentTask-Project && git checkout main && git pull --ff-only origin main && bash scripts/deploy-ec2.sh"
                                set "SSH_EXIT_CODE=!ERRORLEVEL!"

:cleanup_key
                                del /F /Q "!RESTRICTED_KEY!" >NUL 2>&1
                                exit /b !SSH_EXIT_CODE!
                            '''
                        }
                    }
                }
            }
        }

        stage('Verify AWS Health') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'assignment-tracker-ec2-host',
                        variable: 'EC2_HOST'
                    )
                ]) {
                    script {
                        if (isUnix()) {
                            sh '''
                                for attempt in $(seq 1 30); do
                                  echo "AWS health check attempt $attempt of 30..."

                                  if node -e "fetch('http://' + process.env.EC2_HOST + ':3000/health', { signal: AbortSignal.timeout(5000) }).then(async (response) => { const body = await response.text(); console.log(body); if (!response.ok) process.exit(1); }).catch((error) => { console.error(error.message); process.exit(1); });"; then
                                    exit 0
                                  fi

                                  if [ "$attempt" -lt 30 ]; then
                                    sleep 5
                                  fi
                                done

                                echo "Public AWS health check failed after 30 attempts."
                                exit 1
                            '''
                        } else {
                            bat '''
                                @echo off
                                for /L %%I in (1,1,30) do (
                                    echo AWS health check attempt %%I of 30...

                                    node -e "fetch('http://' + process.env.EC2_HOST + ':3000/health', { signal: AbortSignal.timeout(5000) }).then(async (response) => { const body = await response.text(); console.log(body); if (!response.ok) process.exit(1); }).catch((error) => { console.error(error.message); process.exit(1); });"
                                    if not errorlevel 1 exit /b 0

                                    if not %%I==30 powershell -NoProfile -Command "Start-Sleep -Seconds 5"
                                )

                                echo Public AWS health check failed after 30 attempts.
                                exit /b 1
                            '''
                        }
                    }
                }
            }
        }
    }

    post {
        failure {
            script {
                if (env.DEPLOYMENT_STARTED == 'true') {
                    echo 'Local deployment failed. Showing container status and logs before cleanup.'

                    if (isUnix()) {
                        sh(returnStatus: true, script: 'docker compose ps')
                        sh(returnStatus: true, script: 'docker compose logs --no-color --tail=200 app database')
                        sh(returnStatus: true, script: 'docker compose down --remove-orphans')
                    } else {
                        bat(returnStatus: true, script: 'docker compose ps')
                        bat(returnStatus: true, script: 'docker compose logs --no-color --tail=200 app database')
                        bat(returnStatus: true, script: 'docker compose down --remove-orphans')
                    }
                }
            }
        }

        always {
            echo "Pipeline result: ${currentBuild.currentResult}"
        }
    }
}
