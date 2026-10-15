FROM eclipse-mosquitto:2

# envsubst for rendering config from env vars
RUN apk add --no-cache gettext

COPY mosquitto.conf.template /etc/adro/mosquitto.conf.template
COPY docker-entrypoint.sh /usr/local/bin/adro-entrypoint

RUN chmod +x /usr/local/bin/adro-entrypoint

ENTRYPOINT ["/usr/local/bin/adro-entrypoint"]
