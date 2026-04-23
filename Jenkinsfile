pipeline {
  agent {
    kubernetes {
      defaultContainer 'devops'
      yaml '''
apiVersion: v1
kind: Pod
spec:
  volumes:
    - name: docker-sock
      hostPath:
        path: /var/run/docker.sock
  containers:
    - name: devops
      image: 348071628290.dkr.ecr.ap-south-1.amazonaws.com/jenkins-agent-devops:latest
      command:
        - cat
      tty: true
      securityContext:
        runAsUser: 0
      volumeMounts:
        - name: docker-sock
          mountPath: /var/run/docker.sock
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
    stage('Debug Tools') {
      steps {
        sh '''
          which docker || true
          docker --version || true
          which aws || true
          aws --version || true
          which kubectl || true
          kubectl version --client || true
          ls -l /var/run/docker.sock || true
        '''
      }
    }

    stage('Prepare Git') {
      steps {
        sh 'git config --global --add safe.directory /home/jenkins/agent/workspace/shcp-pipeline'
      }
    }

    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
        }
      }
    }

    stage('Build Docker Image') {
      steps {
        sh """
          docker build -t ${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG} ${SERVICE_PATH}
        """
      }
    }

    stage('Push Docker Image') {
      steps {
        sh """
          aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}
          docker push ${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}
        """
      }
    }

    stage('Update kubeconfig') {
      steps {
        sh """
          aws eks update-kubeconfig --region ${AWS_REGION} --name ${EKS_CLUSTER}
        """
      }
    }

    stage('Deploy to dev') {
      steps {
        script {
          deployEnv('dev')
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
        script {
          deployEnv('test')
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
        script {
          deployEnv('prod')
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