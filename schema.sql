create database nginx;

-- DROP TABLE nginx.access_log;

CREATE TABLE IF NOT EXISTS nginx.access_log
(
    timestamp            DateTime,
    hostname             String,
    server_name          String,
    host                 String,
    uri                  String,
    request_uri          String,
    request_method       String,
    status               Int16,
    http_referrer        String,
    http_user_agent      String,
    response_time        Float32,
    body_bytes_sent      UInt32,
    remote_addr          String,
    geoip_country_name   String
)
engine = Null;

-- DROP TABLE nginx.report_access_log_by_all;

CREATE TABLE IF NOT EXISTS nginx.report_access_log_by_all
(
    timestamp                 DateTime,
    hostname                  String,
    server_name               String,
    host                      String,
    request_uri               String,
    request_method            String,
    status                    Int16,
    cache                     UInt8,

    n                         UInt64,

    response_time_sum         Float64,
    body_bytes_sent_sum       UInt64,

    response_time_max         Float32,
    body_bytes_sent_max       UInt32
) Engine MergeTree
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (timestamp, hostname, server_name, host, request_uri, request_method, status, cache);

-- DROP TABLE view_report_access_log_by_all;

CREATE MATERIALIZED VIEW nginx.view_report_access_log_by_all TO nginx.report_access_log_by_all AS
SELECT
    toStartOfMinute(timestamp) as timestamp,
    hostname,
    server_name,
    host,
    multiIf(request_uri LIKE '%?%', replaceRegexpOne(request_uri, '([^?]*)\?.*', '\\1'), request_uri LIKE '/%/%.%', replaceRegexpOne(request_uri, '/([^/]*)/.*\.([^.]+)$', '/\\1/*'), request_uri) as request_uri,
    request_method,
    status,
    if(response_time = 0, 1, 2) as cache,

    count(*) as n,

    sum(response_time) as response_time_sum,
    sum(body_bytes_sent) as body_bytes_sent_sum,

    max(response_time)   as response_time_max,
    max(body_bytes_sent) as body_bytes_sent_max

FROM nginx.access_log
GROUP BY timestamp, hostname, server_name, host, request_uri, request_method, status, cache;
