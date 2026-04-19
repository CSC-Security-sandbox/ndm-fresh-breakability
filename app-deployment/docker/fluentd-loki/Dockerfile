# Base image: match the known-good production bundle.
# The elasticsearch7 variant ships with all the plugins our fluent.conf needs
# pre-installed (kubernetes_metadata, multi_format_parser, prometheus,
# rewrite_tag_filter, record_transformer, grep, parser-regexp, ...). The
# `debian-forward-*` variant is minimal and would require us to gem-install
# each of those plugins by hand; staying on elasticsearch7 keeps the image
# byte-compatible with the last tarball that deployed cleanly on the VM.
FROM fluent/fluentd-kubernetes-daemonset:v1.17.1-debian-elasticsearch7-1.2

USER root

# Add plugins here only when they are not bundled by the elasticsearch7 base,
# or when we want to pin one explicitly. fluent-plugin-grafana-loki provides
# our Loki output and is not in the base. fluent-plugin-rewrite-tag-filter is
# currently bundled by the base, but we install it explicitly so it stays
# present at a known version even if a future base-image upgrade drops it.
RUN gem install fluent-plugin-grafana-loki -v 1.2.20 --no-document \
    && gem install fluent-plugin-rewrite-tag-filter -v 2.4.0 --no-document \
    && gem sources --clear-all \
    && rm -rf /tmp/* /var/tmp/* /usr/lib/ruby/gems/*/cache/*.gem

USER fluent
