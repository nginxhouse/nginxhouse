##### Requirements
- nodejs
- clickhouse

##### Installation

- `cd /opt`
- `git clone https://github.com/nginxhouse/nginxhouse.git`
- `cd nginxhouse`
- `clickhouse-client -n < schema.sql`

##### Usage

- `node nginxhouse.js`

##### Systemd autostart script
- `sudo cp nginxhouse.service /usr/lib/systemd/system/nginxhouse.service`
- `sudo systemctl daemon-reload && systemctl enable nginxhouse && systemctl start nginxhouse`
- add into nginx config inside http section: `log_format json escape=json '{"timestamp": "$time_iso8601", "hostname": "$hostname", "server_name": "$server_name", "host": "$host", "request_uri": "$request_uri", "request_method": "$request_method", "status": $status, "http_referrer": "$http_referer", "http_user_agent": "$http_user_agent", "response_time": $upstream_response_time, "body_bytes_sent": $body_bytes_sent, "remote_addr": "$remote_addr"}';`

##### Stats for 24 hours with about 450 RPS on nginx:

|table|rows|size, Mb|description|
|---|---|---|---|
|access_log|45kk|0|raw data|
|access_log_report_by_all|300k|9|aggregated data by minutes|

##### Grafana
dashboard [#10011](https://grafana.com/dashboards/10011)

grafana_dashboard.png

##### License
MIT License.

##### See also
