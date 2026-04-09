# 📄 SRS — Clipboard Sync (MVP v1)

## 1. 🧱 Requerimientos funcionales

### RF-01: Generación de código

- El sistema debe generar un código único por sesión
- Debe tener TTL (2-5 minutos)
- Debe ser difícil de adivinar

Formato sugerido:
ABC-92K

---

### RF-02: Unión a sesión

- Usuario puede ingresar código
- Sistema valida existencia
- Se vincula al canal

---

### RF-03: Creación de sesión efímera

- Se crea un "room"
- Máximo 2 dispositivos (MVP)
- TTL automático

---

### RF-04: Transmisión de texto

- Enviar texto al servidor
- Reenviar a dispositivos conectados
- Entrega en tiempo real

---

### RF-05: Recepción

- Mostrar texto recibido
- Permitir copiar fácilmente

---

### RF-06: Desconexión

- Si un cliente se desconecta:
  - se elimina la sesión si queda vacía
  - se notifica al otro cliente

---

## 2. 🔐 Requerimientos no funcionales

### RNF-01: Latencia

- Tiempo de entrega < 1 segundo

---

### RNF-02: Seguridad

- No almacenar texto permanentemente
- Sanitización contra XSS
- TTL obligatorio
- Rate limit por IP

---

### RNF-03: Escalabilidad

- Arquitectura stateless
- Redis Pub/Sub (futuro)
- Horizontal scaling

---

### RNF-04: Disponibilidad

- 99% uptime (MVP aceptable)

---

## 3. 📦 Modelo de datos (efímero)

### Session

```json
{
  "session_id": "uuid",
  "code": "ABC-92K",
  "created_at": "timestamp",
  "expires_at": "timestamp",
  "devices": ["device_1", "device_2"]
}

Device
{
  "device_id": "uuid",
  "connected_at": "timestamp",
  "socket_id": "string"
}
Message (NO persistente)
{
  "message_id": "uuid",
  "session_id": "uuid",
  "sender_device": "device_id",
  "content": "string",
  "timestamp": "timestamp"
}
4. 🔌 API / Eventos (WebSocket)
create_session
{
  "type": "create_session"
}

Respuesta:

{
  "code": "ABC-92K"
}
join_session
{
  "type": "join_session",
  "code": "ABC-92K"
}
send_clip
{
  "type": "send_clip",
  "content": "texto copiado"
}
receive_clip
{
  "type": "receive_clip",
  "content": "texto recibido"
}
session_expired
{
  "type": "session_expired"
}
5. 🔐 Seguridad
Nivel MVP
Validar tamaño de texto (máx 10KB)
Escape HTML
TTL sesiones (5 min)
No logs con contenido
Nivel futuro
Encriptación end-to-end
Tokens de sesión
Device fingerprinting
Detección de abuso
6. ⚙️ Stack recomendado
Backend
Node.js + WebSocket (ws)
Redis (opcional)
Frontend
React + Tailwind
WebSocket client
Infra
Vercel / Cloudflare (frontend)
Railway / Fly.io / DigitalOcean (backend)
Upstash Redis
7. 🧪 Riesgos
Spam / abuso
Brute force de códigos
Interceptación sin cifrado
Límites de WebSocket en hosting
8. 🧠 Decisiones clave
Código en vez de login → menor fricción
In-memory → mayor velocidad
WebSockets → realtime real
TTL agresivo → seguridad