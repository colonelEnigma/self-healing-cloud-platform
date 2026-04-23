pipeline {
  agent {
    kubernetes {
      defaultContainer 'devops'
      yaml '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins-deployer
  volumes:
    - name: shared-auth
      emptyDir: {}
  containers:
    - name: devops
      image: 348071628290.dkr.ecr.ap-south-1.amazonaws.com/jenkins-agent-devops:latest
      command:
        - cat
      tty: true
      volumeMounts:
        - name: shared-auth
          mountPath: /shared-auth

    - name: buildah
      image: quay.io/buildah/stable:latest
      command:
        - cat
      tty: true
      securityContext:
        privileged: true
      volumeMounts:
        - name: shared-auth
          mountPath: /shared-auth
'''
    }
  }

  environment {
    AWS_REGION      = 'ap-south-1'
    AWS_ACCOUNT_ID  = '348071628290'
    ECR_REGISTRY    = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    ECR_REPOSITORY  = 'order-service'
    EKS_CLUSTER     = 'self-healing-cluster'
    SERVICE_NAME    = 'order-service'
    SERVICE_PATH    = 'services/order-service'
    K8S_PATH        = 'k8s/order-service'
  }

  options {
    disableConcurrentBuilds()
  }

  stages {
    stage('Prepare Git') {
      steps {
        container('devops') {
          sh 'git config --global --add safe.directory "*"'
        }
      }
    }

    stage('Checkout') {
      steps {
        container('devops') {
          checkout scm
          script {
            env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          }
        }
      }
    }

    stage('Debug Tools') {
      steps {
        container('devops') {
          sh '''
            git --version || true
            aws --version || true
            kubectl version --client || true
          '''
        }
        container('buildah') {
          sh '''
            buildah --version || true
          '''
        }
      }
    }

    stage('Login to ECR') {
        steps {
            container('devops') {
            withCredentials([
                string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'),
                string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')
            ]) {
                sh '''
                mkdir -p /shared-auth
                aws ecr get-login-password --region ${AWS_REGION} > /shared-auth/ecr-password
                '''
            }
            }
        }
    }

    stage('Build and Push Image') {
        steps {
            container('buildah') {
            sh '''
                export REGISTRY_AUTH_FILE=/tmp/auth.json

                cat /shared-auth/ecr-password | buildah login --username AWS --password-stdin ${ECR_REGISTRY}

                buildah bud \
                -t ${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG} \
                ${SERVICE_PATH}

                buildah push \
                ${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}
            '''
            }
        }
    }

    stage('Update kubeconfig') {
      steps {
        container('devops') {
          sh """
            aws eks update-kubeconfig --region ${AWS_REGION} --name ${EKS_CLUSTER}
          """
        }
      }
    }

    stage('Check RBAC') {
        steps {
            container('devops') {
            sh '''
                kubectl auth can-i get deployments -n dev
                kubectl auth can-i patch deployments -n dev
                kubectl auth can-i get deployments -n test
                kubectl auth can-i patch deployments -n test
            '''
            }
        }
    }

    stage('Deploy to dev') {
      steps {
        container('devops') {
          script {
            deployEnv('dev')
          }
        }
      }
    }

    stage('Approve test') {
      steps {
        input message: "Promote ${SERVICE_NAME}:${IMAGE_TAG} to test?"
      }
    }

    stage('Deploy to test') {
      steps {
        container('devops') {
          script {
            deployEnv('test')
          }
        }
      }
    }

    stage('Approve prod') {
      steps {
        input message: "Promote ${SERVICE_NAME}:${IMAGE_TAG} to prod?"
      }
    }

    stage('Deploy to prod') {
      steps {
        container('devops') {
          script {
            deployEnv('prod')
          }
        }
      }
    }
  }
}

def deployEnv(String targetEnv) {
  def topic = ''
  def dlq = ''

  if (targetEnv == 'dev') {
    topic = 'order_created_dev'
    dlq   = 'order_created_dlq_dev'
  } else if (targetEnv == 'test') {
    topic = 'order_created_test'
    dlq   = 'order_created_dlq_test'
  } else {
    topic = 'order_created'
    dlq   = 'order_created_dlq'
  }

  sh """
    sed \
      -e 's|\\\${NAMESPACE}|${targetEnv}|g' \
      -e 's|\\\${IMAGE_TAG}|${IMAGE_TAG}|g' \
      -e 's|\\\${ORDER_CREATED_TOPIC}|${topic}|g' \
      -e 's|\\\${ORDER_CREATED_DLQ_TOPIC}|${dlq}|g' \
      ${K8S_PATH}/deployment.yml | kubectl apply -f -

    sed \
      -e 's|\\\${NAMESPACE}|${targetEnv}|g' \
      ${K8S_PATH}/service.yml | kubectl apply -f -

    kubectl rollout status deployment/${SERVICE_NAME} -n ${targetEnv}
  """
}