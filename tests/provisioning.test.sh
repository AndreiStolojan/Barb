#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

run_case() {
  local present="$1" temp_dir env_file log_file
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  env_file="${temp_dir}/.env"
  log_file="${temp_dir}/docker.log"
  PROVISION_ENV_FILE="${env_file}" MOCK_LOG="${log_file}" MOCK_MODEL_PRESENT="${present}" bash -c '
    source ./provision
    create_env >/dev/null
    dotenv_set COMPOSE_PROFILES local-db,ai "$ENV_FILE"
    docker() {
      printf "%s\n" "$*" >> "$MOCK_LOG"
      case "$1" in
        info) return 0 ;;
        compose)
          case " $* " in
            *" compose --env-file $ENV_FILE exec -T ollama ollama list "*)
              printf "NAME ID SIZE MODIFIED\n"
              [[ "$MOCK_MODEL_PRESENT" == 1 ]] && printf "%s id size now\n" "$OLLAMA_MODEL"
              ;;
          esac
          return 0 ;;
      esac
    }
    main >/dev/null
  '
  grep -F "compose --env-file ${env_file} up -d --build --wait --wait-timeout 180" "${log_file}"
  grep -F "compose --env-file ${env_file} exec -T backend npm run seed:local" "${log_file}"
  if [[ "${present}" == 1 ]]; then
    if grep -q 'ollama ollama pull' "${log_file}"; then
      echo 'pulled a model that was already present' >&2
      return 1
    fi
  else
    grep -q 'ollama ollama pull' "${log_file}"
  fi
}

run_case 0
run_case 1

temp_dir="$(mktemp -d)"
trap 'rm -rf "${temp_dir}"' EXIT
env_file="${temp_dir}/.env"
PROVISION_ENV_FILE="${env_file}" bash -c 'source ./provision; create_env; load_runtime_values'
test "$(stat -c %a "${env_file}" 2>/dev/null || stat -f %Lp "${env_file}")" = 600
first_hash="$(shasum -a 256 "${env_file}" | awk '{print $1}')"
PROVISION_ENV_FILE="${env_file}" bash -c 'source ./provision; create_env; load_runtime_values'
test "${first_hash}" = "$(shasum -a 256 "${env_file}" | awk '{print $1}')"

cp .env.example "${temp_dir}/custom.env"
# shellcheck disable=SC2016 # the literal $() checks that values are never evaluated
sed -i.bak 's/^APP_PORT=8080$/APP_PORT=8181/; s|^GOOGLE_REDIRECT_URI=.*$|GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/mail-accounts/google/callback|; s/^GOOGLE_CLIENT_SECRET=$/GOOGLE_CLIENT_SECRET="literal $() value"/' "${temp_dir}/custom.env"
rm -f "${temp_dir}/custom.env.bak"
PROVISION_ENV_FILE="${temp_dir}/custom.env" bash -c 'source ./provision; create_env; test "$(dotenv_get GOOGLE_CLIENT_SECRET "$ENV_FILE")" = "literal \$() value"'
grep -Fx 'GOOGLE_REDIRECT_URI=http://localhost:8181/api/v1/mail-accounts/google/callback' "${temp_dir}/custom.env"
grep -Fx 'FRONTEND_APP_URL=http://localhost:8181' "${temp_dir}/custom.env"

if PROVISION_ENV_FILE="${temp_dir}/.env" bash -c 'source ./provision; docker(){ return 1; }; require_docker' >/dev/null 2>&1; then
  echo 'expected Docker prerequisite failure' >&2
  exit 1
fi

# Reject configurations that could target production containers or seed production.
cp "$env_file" "$temp_dir/unsafe.env"
for bad in 'COMPOSE_PROJECT_NAME=secureinbox' 'NODE_ENV=production' 'COMPOSE_PROFILES='; do
  cp "$env_file" "$temp_dir/unsafe.env"
  printf '%s\n' "$bad" >> "$temp_dir/unsafe.env"
  if PROVISION_ENV_FILE="$temp_dir/unsafe.env" bash -c 'source ./provision; load_runtime_values' >/dev/null 2>&1; then
    echo "Expected rejection: $bad" >&2
    exit 1
  fi
done

# Compose prefers exported variables over the env file, so they must not differ.
if DB_URI=mongodb+srv://example.test/secureinbox PROVISION_ENV_FILE="$env_file" bash -c 'source ./provision; load_runtime_values' >/dev/null 2>&1; then
  echo 'Expected rejection of an exported DB_URI' >&2
  exit 1
fi

cp "$env_file" "$temp_dir/atlas.env"
printf '%s\n' 'COMPOSE_PROFILES=' 'DB_URI=mongodb+srv://example.test/secureinbox_test' >> "$temp_dir/atlas.env"
PROVISION_ENV_FILE="$temp_dir/atlas.env" bash -c 'source ./provision; load_runtime_values'
printf '%s\n' 'DB_URI=mongodb+srv://example.test/secureinbox' >> "$temp_dir/atlas.env"
if PROVISION_ENV_FILE="$temp_dir/atlas.env" bash -c 'source ./provision; load_runtime_values' >/dev/null 2>&1; then
  echo 'Expected rejection of production database in development' >&2
  exit 1
fi

# A pre-consolidation production .env (no NODE_ENV) must be refused untouched:
# filling it would replace the secrets that decrypt stored Gmail tokens.
printf '%s\n' 'TUNNEL_TOKEN=existing' 'GRAFANA_ADMIN_PASSWORD=existing' > "$temp_dir/legacy.env"
legacy_hash="$(shasum -a 256 "$temp_dir/legacy.env" | awk '{print $1}')"
if PROVISION_ENV_FILE="$temp_dir/legacy.env" bash -c 'source ./provision; create_env' >/dev/null 2>&1; then
  echo 'Expected refusal of a legacy .env without NODE_ENV' >&2
  exit 1
fi
test "${legacy_hash}" = "$(shasum -a 256 "$temp_dir/legacy.env" | awk '{print $1}')"

# A complete production file passes as is; plain HTTP URLs do not.
cp "$env_file" "$temp_dir/prod.env"
printf '%s\n' NODE_ENV=production COMPOSE_PROJECT_NAME=secureinbox \
  COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml COMPOSE_PROFILES= \
  DB_URI=mongodb+srv://example.test/secureinbox SEED_DEMO=false \
  JWT_SECRET=x MAIL_TOKEN_ENCRYPTION_KEY=x FRONTEND_APP_URL=https://example.test \
  GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x \
  GOOGLE_REDIRECT_URI=https://example.test/api/v1/mail-accounts/google/callback \
  EMAIL_FROM=x EMAIL_PASSWORD=x TUNNEL_TOKEN=x >> "$temp_dir/prod.env"
prod_hash="$(shasum -a 256 "$temp_dir/prod.env" | awk '{print $1}')"
PROVISION_ENV_FILE="$temp_dir/prod.env" bash -c 'source ./provision; create_env; load_runtime_values'
test "${prod_hash}" = "$(shasum -a 256 "$temp_dir/prod.env" | awk '{print $1}')"
printf '%s\n' FRONTEND_APP_URL=http://example.test >> "$temp_dir/prod.env"
if PROVISION_ENV_FILE="$temp_dir/prod.env" bash -c 'source ./provision; load_runtime_values' >/dev/null 2>&1; then
  echo 'Expected rejection of an HTTP production URL' >&2
  exit 1
fi
