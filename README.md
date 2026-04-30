# SharkShell — despliegue seguro (Docker Compose)

## 1) Qué se verificó de la imagen
- Repositorio oficial: `https://github.com/sushilkumarsahani41/SharkShell`
- Imagen usada: `greatsharktech/sharkshell`
- Internals de la imagen:
  - Frontend servido por Nginx en `:80`
  - API backend NestJS en `:3002`
  - Nginx proxya `/api/*` y `/api/socket` a `127.0.0.1:3002`
  - Si no defines variables `DB_*`, levanta PostgreSQL **interno** en `/app/pgdata`
  - En este despliegue se usa PostgreSQL externo para evitar secretos efímeros y facilitar respaldo.

## 2) Estructura creada
- `/opt/sharkshell/docker-compose.yml`
- `/opt/sharkshell/.env.example`
- `/opt/sharkshell/Caddyfile`
- `/opt/sharkshell/scripts/start.sh`
- `/opt/sharkshell/scripts/stop.sh`
- `/opt/sharkshell/scripts/update.sh`
- `/opt/sharkshell/scripts/backup.sh`
- `data/postgres/` persistencia de PostgreSQL
- `data/secrets/` persistencia para la imagen de SharkShell

## 3) Configuración inicial
1. Copia el ejemplo de variables:
   ```bash
   cp /opt/sharkshell/.env.example /opt/sharkshell/.env
   ```
2. Edita `/opt/sharkshell/.env`:
   - Cambia `DB_PASSWORD`
   - Cambia `ENCRYPTION_KEY`
   - Cambia `JWT_SECRET`
3. `SHARKSHELL_BIND_ADDRESS=127.0.0.1` evita exponer `SHARKSHELL_PORT` en red pública.

> No uses secretos reales en mensajes ni tickets: genera y guarda en vault/PasswordManager.

## 4) Arranque y operación
- Levantar:
  ```bash
  cd /opt/sharkshell
  ./scripts/start.sh
  ```
- Estado:
  ```bash
  docker compose ps
  ```
- Logs:
  ```bash
  docker compose logs -f sharkshell
  docker compose logs -f postgres
  ```

## 5) Validación rápida
- Puerto local (por `SHARKSHELL_PORT`, por defecto `8081`):
  ```bash
  curl -I http://127.0.0.1:8081
  ```
- Healthcheck app:
  ```bash
  curl -s http://127.0.0.1:8081/api/health | jq
  ```
- UI:
  Abrir `http://127.0.0.1:8081` y comprobar página de login/setup.
- WebSocket (proxy):
  ```bash
  curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Key: SGVsbG9Xb3JsZA==' \
    -H 'Sec-WebSocket-Version: 13' \
    http://127.0.0.1:8081/api/socket
  ```
  Debe responder `101 Switching Protocols` desde Nginx/Proxy hacia el backend.

## 5bis) Cambio de contraseña (tu solicitud)
- Accede en UI: `http://<host>:<puerto>/dashboard/settings`
- Cambia tu contraseña actual por una nueva (mínimo 8 caracteres).
- Alternativa API (si estás autenticado):
  ```bash
  curl -X POST http://127.0.0.1:8081/api/auth/change-password \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -d '{"currentPassword":"ANTERIOR","newPassword":"NUEVA"}'
  ```

Nota: `sharkshell-custom` incorpora esta ruta; la imagen `greatsharktech/sharkshell` base no incluye edición de contraseña.

## 6) Configurar dominio con HTTPS (Caddy)
- Ajusta `/opt/sharkshell/.env`:
  - `SHARKSHELL_DOMAIN=tu-dominio.tld`
  - `LETSENCRYPT_EMAIL=admin@tu-dominio.tld`
- Ejecuta Caddy en tu host:
  ```bash
  caddy run --config /opt/sharkshell/Caddyfile
  ```
- Asegúrate de que DNS `A/AAAA` apunte al servidor.
- Abrir: `https://tu-dominio.tld`

## 7) Sin dominio: acceso seguro por VPN (recomendado)
### Opción A: Tailscale (simple)
- Instala Tailscale y conéctalo al nodo.
- Expón solo `SHARKSHELL_BIND_ADDRESS=127.0.0.1` y accede por la IP de Tailscale del servidor.

### Opción B: Cloudflare Tunnel
- Mantén Caddy en modo sólo local y publica mediante Tunnel con policy de acceso.

## 8) Firewall (UFW)
- Mantener SSH:
  ```bash
  sudo ufw allow OpenSSH
  ```
- Si usas Caddy/TLS público:
  ```bash
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  ```
- No exponer backend directo:
  - Si la app está ligada a `127.0.0.1`, `SHARKSHELL_PORT` no se publica.
  - Si por error usas bind `0.0.0.0`, entonces:
    ```bash
    sudo ufw deny 8081/tcp
    ```
- Activar reglas:
  ```bash
  sudo ufw --force enable
  sudo ufw status
  ```

## 9) Backup y restore
- Crear backup:
  ```bash
  cd /opt/sharkshell
  ./scripts/backup.sh
  ```
- Restaurar:
  ```bash
  ./scripts/backup.sh restore /opt/sharkshell/backups/sharkshell-data-YYYYmmdd-HHMMSS.tar.gz
  ```

## 10) Actualización y parada
- Actualizar:
  ```bash
  ./scripts/update.sh
  ```
  (si respondes `s`/`y`, ejecuta `docker image prune -f`)
- Parar:
  ```bash
  ./scripts/stop.sh
  ```

## 11) Puntos de persistencia
- Conexiones/usuarios/workspaces/claves se guardan en PostgreSQL (`data/postgres` en este setup).
- Claves y tokens cifrados dependen de:
  - `ENCRYPTION_KEY`
- `data/secrets` se preserva para uso interno de la imagen.

## 12) Riesgos pendientes y hardening previo a producción
- Obliga rotación/secreto centralizado (vault/KMS) para `DB_PASSWORD`, `ENCRYPTION_KEY`, `JWT_SECRET`.
- Limita acceso a Caddy/SSH con MFA.
- Habilita rate limiting si hay exposición pública.
- Activa respaldo offline y prueba de recuperación (`restore`) antes de producción.
- Restringe logs sensibles (no grabar credenciales de conexión en logs con debug).
- Valida alertas y monitorización (CPU/mem/disk, fallos del healthcheck).
