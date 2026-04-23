def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'

  def cfg = [
    serviceName   : 'order-service',
    awsRegion     : 'ap-south-1',
    ecrRegistry   : '348071628290.dkr.ecr.ap-south-1.amazonaws.com',
    ecrRepository : 'order-service',
    servicePath   : 'services/order-service',
    k8sPath       : 'k8s/order-service',
    deploymentFile: 'deployment.yml',
    serviceFile   : 'service.yml',
    kafkaAware    : true
  ]

  common.runService(scriptRef, cfg)
}

return this