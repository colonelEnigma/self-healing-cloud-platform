pipeline {
  agent any

  options {
    disableConcurrentBuilds()
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Detect Changed Services') {
      steps {
        script {
          def changedFilesRaw = sh(
            script: 'git diff --name-only HEAD~1 HEAD || true',
            returnStdout: true
          ).trim()

          def changedFiles = changedFilesRaw ? changedFilesRaw.split('\n') : []
          def commonChanged = changedFiles.any { it == 'jenkins/common.groovy' || it == 'Jenkinsfile' }

          env.RUN_USER    = (commonChanged || changedFiles.any { it.startsWith('services/user-service/')    || it.startsWith('k8s/user-service/')    || it == 'jenkins/user-service.groovy' }) ? 'true' : 'false'
          env.RUN_ORDER   = (commonChanged || changedFiles.any { it.startsWith('services/order-service/')   || it.startsWith('k8s/order-service/')   || it == 'jenkins/order-service.groovy' }) ? 'true' : 'false'
          env.RUN_PRODUCT = (commonChanged || changedFiles.any { it.startsWith('services/product-service/') || it.startsWith('k8s/product-service/') || it == 'jenkins/product-service.groovy' }) ? 'true' : 'false'
          env.RUN_PAYMENT = (commonChanged || changedFiles.any { it.startsWith('services/payment-service/') || it.startsWith('k8s/payment-service/') || it == 'jenkins/payment-service.groovy' }) ? 'true' : 'false'
          env.RUN_SEARCH  = (commonChanged || changedFiles.any { it.startsWith('services/search-service/')  || it.startsWith('k8s/search-service/')  || it == 'jenkins/search-service.groovy' }) ? 'true' : 'false'

          echo "RUN_USER=${env.RUN_USER}"
          echo "RUN_ORDER=${env.RUN_ORDER}"
          echo "RUN_PRODUCT=${env.RUN_PRODUCT}"
          echo "RUN_PAYMENT=${env.RUN_PAYMENT}"
          echo "RUN_SEARCH=${env.RUN_SEARCH}"
        }
      }
    }

    stage('Run Changed Services') {
      steps {
        script {
          def branches = [:]

          if (env.RUN_USER == 'true') {
            branches['user-service'] = {
              def svc = load 'jenkins/user-service.groovy'
              svc.run(this)
            }
          }

          if (env.RUN_ORDER == 'true') {
            branches['order-service'] = {
              def svc = load 'jenkins/order-service.groovy'
              svc.run(this)
            }
          }

          if (env.RUN_PRODUCT == 'true') {
            branches['product-service'] = {
              def svc = load 'jenkins/product-service.groovy'
              svc.run(this)
            }
          }

          if (env.RUN_PAYMENT == 'true') {
            branches['payment-service'] = {
              def svc = load 'jenkins/payment-service.groovy'
              svc.run(this)
            }
          }

          if (env.RUN_SEARCH == 'true') {
            branches['search-service'] = {
              def svc = load 'jenkins/search-service.groovy'
              svc.run(this)
            }
          }

          if (branches.isEmpty()) {
            echo 'No service changes detected.'
          } else {
            parallel branches
          }
        }
      }
    }
  }

  post {
    always {
      echo 'Master pipeline completed.'
    }
  }
}