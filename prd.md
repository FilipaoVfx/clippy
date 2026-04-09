# 📄 PRD — Clipboard Sync (MVP v1)

## 1. 🎯 Objetivo del producto

Construir una plataforma que permita a usuarios:

**Compartir texto entre dispositivos en tiempo real mediante un código de vinculación, sin depender de apps de mensajería.**

---

## 2. 💡 Propuesta de valor

- Sin login obligatorio
- Sin chats ni ruido social
- Vinculación instantánea (código o QR)
- Transmisión casi en tiempo real (<1s ideal)
- Flujo ultra simple: copiar → recibir → copiar

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
- 🧩 Arquitectura desacoplada
- 🧪 Cero fricción onboarding
- 🗑️ Sin persistencia (o ultra mínima)

---

## 5. 🔄 Flujo principal

### Vinculación

1. Usuario A abre web
2. Se genera un código único temporal
3. Usuario B ingresa ese código
4. Se crea una sesión compartida
5. Ambos dispositivos quedan conectados

---

### Transmisión

1. Usuario copia texto (manual en MVP)
2. Se envía evento al backend
3. Backend lo retransmite en tiempo real
4. Dispositivo receptor lo muestra
5. Usuario lo copia

---

## 6. 🧩 Funcionalidades (MVP)

### Core

- Generar código de vinculación
- Unirse mediante código
- Crear sesión efímera
- Transmitir texto en tiempo real
- Mostrar texto recibido
- Copiar con 1 click

---

### Seguridad básica

- TTL en sesiones
- TTL en mensajes
- Sanitización de texto
- Rate limiting básico
- No almacenamiento persistente

---

### UX mínima

- UI simple (input + feed)
- Indicador de conexión
- Estado: conectado / desconectado

---

## 7. 🚫 Fuera de alcance (MVP)

- Historial persistente
- Autenticación con cuentas
- Multimedia (solo texto)
- Sync automático del clipboard del sistema
- Multi-device avanzado

---

## 8. 📊 Métricas de éxito

- Tiempo de vinculación < 10s
- Latencia de entrega < 1s
- % sesiones exitosas > 90%
- Tiempo promedio de uso
- Retención de usuarios

---

## 9. 🏗️ Arquitectura (MVP)

### Componentes

#### Cliente
- Web App (React / Astro)
- Mobile (PWA inicialmente)

#### Backend (Realtime-first)
- WebSocket server (Node / Go)
- In-memory store (Redis recomendado)

---

### Flujo técnico

Client A → WebSocket → Server → WebSocket → Client B

---

## 10. 🚀 Roadmap técnico

### Sprint 1
- WebSocket server
- create/join session
- transmisión básica

### Sprint 2
- TTL sesiones
- UI funcional
- manejo de errores

### Sprint 3
- seguridad básica
- rate limit
- limpieza automática

### Sprint 4
- QR pairing
- mejoras UX

---

## 11. 🔥 Insight clave

La ventaja competitiva es la experiencia:

**“copiar aquí → pegar allá en 1 segundo”**