Aquí tienes ambos documentos **actualizados**, integrando:

* ✅ Reconexión automática
* ✅ Tokens efímeros
* ✅ Persistencia ligera
* ✅ Soporte hasta **5 dispositivos simultáneos**
* ✅ Arquitectura escalable desde el MVP

Listos para usar en tu repo 👇

---

# 📄 `PRD.md`

```md
# 📄 PRD — Clipboard Sync (MVP v2)

## 1. 🎯 Objetivo del producto

Construir una plataforma que permita a usuarios:

**Compartir texto entre múltiples dispositivos en tiempo real mediante un código de vinculación, sin depender de apps de mensajería.**

---

## 2. 💡 Propuesta de valor

- Sin login obligatorio
- Vinculación rápida por código o QR
- Soporte hasta 5 dispositivos simultáneos
- Transmisión en tiempo real (<1s)
- Reconexión automática sin perder sesión
- Flujo simple: copiar → recibir → copiar

---

## 3. 👤 Usuario objetivo

- Developers
- Estudiantes
- Profesionales multitasking
- Usuarios con múltiples dispositivos

---

## 4. 🧠 Principios clave del MVP

- ⚡ Velocidad > features
- 🔐 Seguridad desde el inicio
- 🔄 Tolerancia a desconexiones móviles
- 🧩 Arquitectura desacoplada
- 🗑️ Estado efímero (no persistente)

---

## 5. 🔄 Flujo principal

### Vinculación

1. Usuario A abre web
2. Se genera código temporal
3. Usuario B/C/D/E ingresa código
4. Se crea sesión compartida
5. Hasta 5 dispositivos conectados

---

### Transmisión

1. Usuario copia texto
2. Se envía al backend
3. Backend retransmite a todos los dispositivos conectados
4. Dispositivos reciben en tiempo real

---

### Reconexión

1. Usuario cambia de app (móvil)
2. WebSocket se pierde
3. Usuario regresa
4. App detecta foco
5. Usa token local para reconectar
6. Continúa sesión sin nuevo código

---

## 6. 🧩 Funcionalidades (MVP)

### Core

- Generar código de vinculación
- Unirse mediante código
- Sesión efímera compartida
- Soporte multi-device (máx 5)
- Transmisión en tiempo real
- Recepción instantánea
- Copiar con 1 click

---

### Reconexión inteligente

- Auto reconexión al volver a foco
- Token efímero local
- Persistencia de sesión temporal
- Tolerancia a suspensión móvil

---

### Seguridad básica

- TTL en sesiones (10–30 min)
- TTL en mensajes
- Sanitización de texto
- Rate limiting
- No persistencia de contenido

---

## 7. 🚫 Fuera de alcance

- Historial persistente
- Multimedia
- Sync automático del sistema clipboard
- Login obligatorio

---

## 8. 📊 Métricas de éxito

- Latencia < 1s
- Reconexión exitosa > 95%
- Tiempo de vinculación < 10s
- Sesiones activas concurrentes
- Retención de sesión tras cambio de app

---

## 9. 🏗️ Arquitectura (MVP)

### Cliente

- Web (React / Astro)
- PWA móvil
- Desktop (futuro: Tauri)

---

### Backend

- WebSocket server
- In-memory + Redis opcional
- Session manager

---

### Flujo técnico

Client → WS → Server → Broadcast → Clients

---

## 10. 🧠 Modelo conceptual

- Session = canal compartido
- Device = cliente conectado
- Resume Token = acceso efímero
- Socket = conexión temporal

---

## 11. 🚀 Roadmap

### Sprint 1
- WebSocket base
- create/join
- broadcast

### Sprint 2
- multi-device (hasta 5)
- TTL sesiones
- UI funcional

### Sprint 3
- reconexión automática
- tokens efímeros
- eventos de foco

### Sprint 4
- QR pairing
- mejoras UX

---

## 12. 🔥 Insight clave

**El producto no es mensajería.  
Es continuidad entre dispositivos.**
```

---

# 📄 `SRS.md`

````md
# 📄 SRS — Clipboard Sync (MVP v2)

## 1. 🧱 Requerimientos funcionales

---

### RF-01: Generación de código

- Código único por sesión
- TTL: 2–5 minutos
- Difícil de adivinar

---

### RF-02: Unión a sesión

- Validar código
- Asociar dispositivo
- Máximo 5 dispositivos

---

### RF-03: Sesión efímera multi-dispositivo

- Crear "room"
- Máx 5 dispositivos
- TTL: 10–30 minutos

---

### RF-04: Transmisión de texto

- Enviar mensaje
- Broadcast a todos los dispositivos
- Entrega en tiempo real

---

### RF-05: Recepción

- Mostrar contenido
- Permitir copiar

---

### RF-06: Manejo de desconexión

- No eliminar sesión inmediatamente
- Marcar dispositivo como desconectado temporal

---

### RF-07: Persistencia de sesión

- Mantener sesión aunque el socket caiga
- No requerir nuevo código si sigue activa

---

### RF-08: Reconexión automática

- Detectar:
  - focus
  - visibilitychange
  - online
- Reconectar automáticamente

---

### RF-09: Almacenamiento local efímero

Guardar:

```json
{
  "session_id": "uuid",
  "device_id": "uuid",
  "resume_token": "token",
  "expires_at": "timestamp"
}
````

---

### RF-10: Reanudación mediante token

* Validar:

  * session_id
  * device_id
  * resume_token
* Restaurar sesión

---

### RF-11: Estado de sesión

Estados posibles:

* active
* temporarily_disconnected
* expired

---

### RF-12: Broadcast multi-device

* Todos los dispositivos reciben el mensaje
* Excluye opcionalmente al sender

---

## 2. 🔐 Requerimientos no funcionales

---

### RNF-01: Latencia

< 1 segundo

---

### RNF-02: Seguridad

* Sin persistencia de contenido
* Sanitización XSS
* TTL obligatorio
* Rate limiting

---

### RNF-03: Escalabilidad

* Stateless server
* Redis Pub/Sub (futuro)
* Horizontal scaling

---

### RNF-04: Tolerancia móvil

* Soporte suspensión en background
* Reconexión automática

---

### RNF-05: Recuperación

* Reconexión < 2 segundos

---

## 3. 📦 Modelo de datos

---

### Session

```json
{
  "session_id": "uuid",
  "code": "ABC-92K",
  "devices": ["dev1", "dev2"],
  "expires_at": "timestamp"
}
```

---

### Device

```json
{
  "device_id": "uuid",
  "socket_id": "string",
  "status": "connected | disconnected"
}
```

---

### Message (no persistente)

```json
{
  "content": "text",
  "sender": "device_id",
  "timestamp": "timestamp"
}
```

---

## 4. 🔌 WebSocket eventos

---

### create_session

```json
{
  "type": "create_session"
}
```

---

### join_session

```json
{
  "type": "join_session",
  "code": "ABC-92K"
}
```

---

### resume_session

```json
{
  "type": "resume_session",
  "session_id": "uuid",
  "device_id": "uuid",
  "resume_token": "token"
}
```

---

### send_clip

```json
{
  "type": "send_clip",
  "content": "text"
}
```

---

### receive_clip

```json
{
  "type": "receive_clip",
  "content": "text"
}
```

---

## 5. 🔐 Seguridad

---

### MVP

* Tamaño máx: 10KB
* Escape HTML
* TTL agresivo
* No logs sensibles

---

### Futuro

* End-to-end encryption
* Device trust model
* Token rotation

---

## 6. ⚙️ Stack recomendado

---

### Backend

* Node.js + WebSocket (ws)
* Redis (opcional)

---

### Frontend

* React + Tailwind
* WebSocket client

---

### Infra

* Vercel / Cloudflare
* Railway / Fly.io / DO
* Upstash Redis

---

## 7. 🧪 Riesgos

* Brute force códigos
* Spam
* pérdida de conexión móvil
* limitaciones de navegador

---

## 8. 🧠 Decisiones clave

* Código en vez de login
* In-memory sobre DB
* WebSockets sobre polling
* TTL agresivo
* Tokens efímeros para reconexión

---

## 9. 🔥 Conclusión técnica

El sistema debe desacoplar:

* sesión
* conexión
* autenticación efímera

Para garantizar continuidad real entre dispositivos.

```

---

