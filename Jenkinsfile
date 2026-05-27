pipeline {
    agent any

    environment {
        BACKEND_URL     = 'http://localhost:8080'
        FRONTEND_URL    = 'http://localhost:3000'
        DISCORD_WEBHOOK = credentials('discord-webhook')
        FAILED_STAGE    = 'Unknown'
    }

    stages {

        // ── 1. 소스 체크아웃 ──────────────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.BRANCH_SHORT = env.GIT_BRANCH.replaceAll('origin/', '')
                    def commit = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    def branchSlug = env.BRANCH_SHORT.replaceAll('/', '_')
                    def marker = "/var/lib/jenkins/.seoganpyo_last_commit_${branchSlug}"
                    def last   = sh(script: "cat ${marker} 2>/dev/null || echo ''", returnStdout: true).trim()
                    def isManual = currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause').size() > 0
                    if (!isManual && last == commit) {
                        echo "동일 커밋(${commit.take(8)}) — 재빌드 건너뜀"
                        currentBuild.result = 'ABORTED'
                        throw new org.jenkinsci.plugins.workflow.steps.FlowInterruptedException(
                            hudson.model.Result.ABORTED
                        )
                    }
                    if (isManual) echo "수동 빌드 — 동일 커밋 체크 건너뜀"
                    sh "echo '${commit}' > ${marker}"
                    echo "브랜치: ${env.BRANCH_SHORT} | 커밋: ${commit.take(8)}"
                }
            }
        }

        // ── 2. CI: 코드 품질 점검 (dev 전용) ─────────────────────────
        stage('CI - Lint & Check') {
            parallel {

                stage('Backend Lint') {
                    when { expression { return env.BRANCH_SHORT == 'dev' } }
                    steps {
                        script { currentBuild.description = 'Backend Lint' }
                        sh '''
                            python3 -m venv .venv-lint
                            .venv-lint/bin/pip install ruff --quiet
                            .venv-lint/bin/ruff check app/ --output-format=github
                        '''
                    }
                }

                stage('Frontend Build') {
                    when { expression { return env.BRANCH_SHORT == 'dev' } }
                    steps {
                        script { currentBuild.description = 'Frontend Build' }
                        dir('frontend') {
                            sh '''
                                /usr/bin/npm install --prefix $HOME/.npm-global pnpm@10.32.1 --quiet
                                PNPM="$HOME/.npm-global/node_modules/.bin/pnpm"
                                export COREPACK_ENABLE_STRICT=0
                                $PNPM install --frozen-lockfile
                                $PNPM build
                            '''
                        }
                    }
                }

            }
        }

        // ── 3. 테스트 & 커버리지 (dev 전용) ─────────────────────────
        stage('Test & Coverage') {
            when { expression { return env.BRANCH_SHORT == 'dev' } }
            steps {
                script { currentBuild.description = 'Test & Coverage' }
                sh '''
                    python3 -m venv .venv-test
                    .venv-test/bin/pip install -r requirements.txt --quiet
                    mkdir -p reports
                    TEST_DATABASE_URL=sqlite:///./test_ci.db \
                    SECRET_KEY=ci-test-secret \
                    .venv-test/bin/python -m pytest tests/ \
                        --junit-xml=reports/test-results.xml \
                        --cov=app \
                        --cov-report=xml:reports/coverage.xml \
                        --cov-report=term-missing \
                        -v
                '''
            }
            post {
                always {
                    junit 'reports/test-results.xml'
                }
                success {
                    echo "테스트 통과"
                }
                failure {
                    echo "테스트 실패 — reports/test-results.xml 확인"
                }
            }
        }

        // ── 4. SCA + Secret + IaC 스캔 (Trivy, dev 전용) ─────────────
        stage('Security Scan - Trivy (SCA/Secret/IaC)') {
            when { expression { return env.BRANCH_SHORT == 'dev' } }
            steps {
                script { currentBuild.description = 'Trivy fs' }
                sh '''
                    mkdir -p security-reports

                    docker run --rm -v "$(pwd)":/src \
                        aquasec/trivy:latest fs \
                        --format json \
                        --output /src/security-reports/trivy-fs.json \
                        --severity HIGH,CRITICAL \
                        --scanners vuln,secret,config \
                        /src || true

                    ls -la security-reports/
                '''
            }
        }

        // ── 4-1. SAST 스캔 (Snyk Code, dev 전용) ─────────────────────
        // Snyk Code 는 정적 코드 분석(SAST) — Trivy 의존성 스캔이 못 보는
        // "코드 자체의 취약점 패턴"(SQLi 후보, 위험한 eval/exec, 하드코딩 비밀 등)을 찾는다.
        // 결과는 SARIF 로 출력해 DefectDojo "SARIF" importer 로 업로드.
        stage('Security Scan - Snyk Code (SAST)') {
            when { expression { return env.BRANCH_SHORT == 'dev' } }
            environment {
                SNYK_TOKEN = credentials('snyk-token')
            }
            steps {
                script { currentBuild.description = 'Snyk Code SAST' }
                sh '''
                    mkdir -p security-reports

                    # snyk/snyk:linux 이미지에 snyk CLI 포함.
                    # snyk code test 는 finding 발견 시 exit 1 — || true 로 빌드 계속.
                    docker run --rm \
                        -e SNYK_TOKEN="${SNYK_TOKEN}" \
                        -v "$(pwd):/project" \
                        -w /project \
                        snyk/snyk:linux \
                        snyk code test \
                          --sarif-file-output=security-reports/snyk-code.sarif \
                          --severity-threshold=high \
                        || true

                    ls -la security-reports/
                '''
            }
        }

        // ── 4-2. DefectDojo로 모든 스캔 결과 업로드 (dev 전용) ──────
        // Trivy + Snyk Code 결과를 같은 engagement 에 통합 등록.
        // close_old_findings=true 로 새 스캔에 없는 옛 finding 자동 mitigated.
        stage('Upload to Defect Dojo') {
            when { expression { return env.BRANCH_SHORT == 'dev' } }
            environment {
                DD_URL        = 'http://163.239.77.65:8888'
                DD_TOKEN      = credentials('defectdojo-token')
                DD_ENGAGEMENT = '1'
            }
            steps {
                sh '''
                    # ─ Trivy (SCA + Secret + IaC) ─
                    if [ -s "security-reports/trivy-fs.json" ]; then
                        curl -sf -X POST "${DD_URL}/api/v2/import-scan/" \
                            -H "Authorization: Token ${DD_TOKEN}" \
                            -F "scan_type=Trivy Scan" \
                            -F "engagement=${DD_ENGAGEMENT}" \
                            -F "file=@security-reports/trivy-fs.json" \
                            -F "active=true" \
                            -F "verified=false" \
                            -F "close_old_findings=true" \
                            -F "branch_tag=${BRANCH_SHORT}" \
                            -F "build_id=${BUILD_NUMBER}" \
                            > /dev/null && echo "Uploaded: trivy-fs.json"
                    else
                        echo "No trivy-fs.json to upload"
                    fi

                    # ─ Snyk Code (SAST, SARIF) ─
                    if [ -s "security-reports/snyk-code.sarif" ]; then
                        curl -sf -X POST "${DD_URL}/api/v2/import-scan/" \
                            -H "Authorization: Token ${DD_TOKEN}" \
                            -F "scan_type=SARIF" \
                            -F "engagement=${DD_ENGAGEMENT}" \
                            -F "file=@security-reports/snyk-code.sarif" \
                            -F "active=true" \
                            -F "verified=false" \
                            -F "close_old_findings=true" \
                            -F "branch_tag=${BRANCH_SHORT}" \
                            -F "build_id=${BUILD_NUMBER}" \
                            > /dev/null && echo "Uploaded: snyk-code.sarif"
                    else
                        echo "No snyk-code.sarif to upload"
                    fi
                '''
            }
        }

        // ── 5. 배포 전 점검 (main 전용) ──────────────────────────────
        stage('Pre-Deploy Check') {
            when { expression { return env.BRANCH_SHORT == 'main' } }
            steps {
                script { currentBuild.description = 'Pre-Deploy Check' }
                sh 'bash scripts/pre-deploy.sh'
            }
        }

        // ── 6. Docker 빌드 & 배포 (main 전용) ───────────────────────
        //
        // 시크릿 관리 정책:
        //   - 변하지 않는 설정 (DB 호스트, 포트, 도메인 등): 서버 .env에 사람이 한 번 작성
        //   - 자주 회전하거나 민감한 키 (API 키, 패스워드): Jenkins Credentials → 배포 시 .env에 주입
        //
        // 시크릿 추가 방법:
        //   1. Jenkins → Credentials → 새 Secret text 등록 (ID: kebab-case)
        //   2. 아래 environment 블록에 한 줄 추가
        //   3. steps의 update_env 호출에 한 줄 추가
        stage('Deploy') {
            when { expression { return env.BRANCH_SHORT == 'main' } }
            environment {
                // ── 자주 회전하는 시크릿 ──
                GEMINI_API_KEY  = credentials('gemini-api-key')       // 포트폴리오 평가 + admin 챗봇
                MISTRAL_API_KEY = credentials('mistral-api-key')      // OCR 마이크로서비스
                // 새 시크릿은 여기에 한 줄 추가하면 됨
                // EXAMPLE_KEY  = credentials('example-key')
            }
            steps {
                script { currentBuild.description = 'Deploy' }
                sh '''
                    # 시크릿이 set -x로 로그에 노출되지 않도록 비활성화
                    set +x

                    # ── .env 구성 전략 ──
                    # 1) 영구 base .env를 workspace로 복사 (DB, 도메인 등 안 변하는 값)
                    # 2) Jenkins Credentials의 시크릿을 덮어씌움 (API 키 등 자주 회전)
                    #
                    # base .env 추가/수정은 사람이 SSH로 직접:
                    #   sudo nano /var/lib/jenkins/seoganpyo-prod.env
                    BASE_ENV="/var/lib/jenkins/seoganpyo-prod.env"
                    if [ -f "$BASE_ENV" ]; then
                        cp "$BASE_ENV" .env
                        echo "Base .env 복사 완료 ($(wc -l < .env)줄)"
                    else
                        echo "⚠️ Base .env 없음 ($BASE_ENV) — 빈 .env로 진행"
                        echo "⚠️ 다음 명령어로 영구 .env를 만드세요:"
                        echo "  sudo cp .env $BASE_ENV"
                        echo "  sudo chown jenkins:jenkins $BASE_ENV"
                        echo "  sudo chmod 600 $BASE_ENV"
                        touch .env
                    fi

                    # .env의 특정 키를 안전하게 갱신하는 헬퍼
                    # - 기존 라인 제거 후 새 값 추가
                    # - printf 사용으로 특수문자 안전
                    update_env() {
                        local key="$1"
                        local value="$2"
                        sed -i "/^${key}=/d" .env 2>/dev/null || true
                        printf '%s=%s\\n' "${key}" "${value}" >> .env
                    }

                    # ── Jenkins Credentials → .env 주입 ──
                    update_env "GEMINI_API_KEY"  "${GEMINI_API_KEY}"
                    update_env "MISTRAL_API_KEY" "${MISTRAL_API_KEY}"
                    # 새 시크릿은 여기에 한 줄 추가하면 됨
                    # update_env "EXAMPLE_KEY"   "${EXAMPLE_KEY}"

                    set -x

                    docker compose stop backend frontend ocr-service redis || true
                    docker compose rm -f backend frontend ocr-service redis || true
                    # 이름 기반 강제 정리 — compose 가 트래킹 잃은 orphan 컨테이너 방지.
                    # 빌드 #264 (v2.1.0) 에서 seoganpyo-frontend 가 compose 프로젝트 밖에 남아있어
                    # up 시 "container name already in use" 충돌로 실패. 같은 사고 재발 차단용.
                    # 이미 위에서 rm 된 경우엔 no-op (|| true).
                    docker rm -f seoganpyo-api seoganpyo-frontend seoganpyo-ocr seoganpyo-redis 2>/dev/null || true

                    # bind-mount 디렉토리 ownership 을 backend 컨테이너 runtime UID(appuser=10001)에 맞춤.
                    # 배경: backend 가 PR #177 부터 non-root(USER appuser, UID 10001) 로 동작하는데
                    #   docker-compose 의 ./static:/app/static, ./data:/app/data 가 bind mount 라
                    #   호스트 디렉토리 소유주가 root 또는 jenkins 이면 컨테이너가 EACCES 로 쓰기 실패
                    #   (OCR 이미지 업로드 / 게시판 첨부 / 강의계획서 캐시 등).
                    # Image 레이어의 COPY --chown 은 bind mount 가 덮어씌워 무효 → 호스트 측에서 조정해야 함.
                    # sudo 권한 없이 처리: docker 의 root 권한으로 alpine 컨테이너 띄워서 chown.
                    mkdir -p static/uploads/posts data
                    docker run --rm \
                        -v "$(pwd)/static:/static" \
                        -v "$(pwd)/data:/data" \
                        alpine sh -c "chown -R 10001:10001 /static /data" || true

                    docker compose -f docker-compose.yml -f docker-compose.observability.app.yml \
                        up --build -d backend frontend ocr-service redis promtail
                '''
            }
        }

        // ── 7. 배포 후 헬스체크 (main 전용) ─────────────────────────
        stage('Post-Deploy Check') {
            when { expression { return env.BRANCH_SHORT == 'main' } }
            steps {
                script { currentBuild.description = 'Post-Deploy Check' }
                sh 'bash scripts/post-deploy.sh'
            }
        }

    }

    post {
        success {
            // Discord Embed 카드 (성공)
            script {
                def cleanBranch = env.BRANCH_SHORT ?: env.GIT_BRANCH.replaceAll('origin/', '')
                sh """
                    /var/lib/jenkins/.venv-scripts/bin/python3 scripts/analyze_logs.py \
                      --mode success \
                      --build-number "${env.BUILD_NUMBER}" \
                      --branch "${cleanBranch}" \
                      --webhook "${env.DISCORD_WEBHOOK}" \
                    || curl -s -X POST "${env.DISCORD_WEBHOOK}" \
                         -H "Content-Type: application/json" \
                         -d "{\\"username\\": \\"Jenkins\\", \\"content\\": \\"✅ **배포 성공** — 빌드 #${env.BUILD_NUMBER} | ${cleanBranch}\\"}"
                """
            }
        }
        failure {
            // Docker 컨테이너 로그 수집 → AI 분석 → Discord Embed 카드 (실패)
            script {
                def cleanBranch = env.BRANCH_SHORT ?: env.GIT_BRANCH.replaceAll('origin/', '')
                sh """
                    /var/lib/jenkins/.venv-scripts/bin/python3 scripts/analyze_logs.py \
                      --mode failure \
                      --build-number "${env.BUILD_NUMBER}" \
                      --branch "${cleanBranch}" \
                      --failed-stage "${currentBuild.description ?: 'Unknown'}" \
                      --webhook "${env.DISCORD_WEBHOOK}" \
                      --containers seoganpyo-api seoganpyo-frontend seoganpyo-ocr \
                    || curl -s -X POST "${env.DISCORD_WEBHOOK}" \
                         -H "Content-Type: application/json" \
                         -d "{\\"username\\": \\"Jenkins\\", \\"content\\": \\"❌ **빌드 실패** — 빌드 #${env.BUILD_NUMBER} | ${cleanBranch} | 실패 단계: ${currentBuild.description ?: 'Unknown'}\\"}"
                """
            }
        }
    }
}
