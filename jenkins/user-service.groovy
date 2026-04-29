def run(scriptRef) {
  def common = scriptRef.load 'jenkins/common.groovy'
  common.runNamedService(scriptRef, 'user-service')
}

return this
