FROM fluent/fluentd-kubernetes-daemonset:v1.17.1-debian-forward-1.2

USER root

RUN gem install fluent-plugin-grafana-loki -v 1.2.20 --no-document \
    && gem install fluent-plugin-rewrite-tag-filter -v 2.4.0 --no-document \
    && gem sources --clear-all \
    && rm -rf /tmp/* /var/tmp/* /usr/lib/ruby/gems/*/cache/*.gem

USER fluent
