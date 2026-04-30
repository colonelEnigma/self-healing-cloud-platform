def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'
  common.runNamedService(scriptRef, 'control-plane-service')
}

return this
