FROM jenkins/inbound-agent:latest

USER root

# Install basic tools
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    git \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# Install kubectl
RUN curl -LO "https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/

# install nodejs and npm
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update && apt-get install -y nodejs

# Install docker CLI (not daemon)
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-24.0.7.tgz \
    | tar xz \
    && mv docker/docker /usr/local/bin/ \
    && rm -rf docker

# Verify installs
RUN kubectl version --client && docker --version

# install aws cli v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && apt-get update && apt-get install -y unzip \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

# Install Helm
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify installs
RUN git --version
RUN aws --version
RUN kubectl version --client
RUN helm version

USER jenkins