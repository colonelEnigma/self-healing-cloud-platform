def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'

  def cfg = [
    serviceName   : 'payment-service',
    awsRegion     : 'ap-south-1',
    ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
    ecrRepository : 'payment-service',
    servicePath   : 'services/payment-service',
    k8sPath       : 'k8s/payment-service',
    deploymentFile: 'deployment.yaml',
    serviceFile   : 'service.yaml',
    kafkaAware    : true
  ]

  common.runService(scriptRef, cfg)
}

return this