#!/bin/sh
set -eu

base="${BOOK_HUB_BASE_PATH:-/}"
case "$base" in
	"" | "/")
		base=""
		;;
	*)
		base="/${base#/}"
		base="${base%/}"
		;;
esac

api_prefix="${base}/api"
static_root="/usr/share/nginx/html/app"
forwarded_prefix="${base:-/}"
template="/etc/book-hub/nginx/templates/default.root.conf.template"
backend_url="http://backend${BOOK_HUB_HTTP_ADDR:-:8080}"

if [ -n "$base" ]; then
	mkdir -p "$(dirname "${static_root}${base}")"
	ln -sfn "$static_root" "${static_root}${base}"
	template="/etc/book-hub/nginx/templates/default.subpath.conf.template"
fi

sed \
	-e "s|__STATIC_ROOT__|${static_root}|g" \
	-e "s|__MAX_BODY_SIZE__|${BOOK_HUB_NGINX_MAX_BODY_SIZE:-310m}|g" \
	-e "s|__API_PREFIX__|${api_prefix}|g" \
	-e "s|__BACKEND_URL__|${backend_url}|g" \
	-e "s|__BASE_PATH__|${base}|g" \
	-e "s|__FORWARDED_PREFIX__|${forwarded_prefix}|g" \
	"$template" >/etc/nginx/conf.d/default.conf
