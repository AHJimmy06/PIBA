# PIBA - Gestión de Repasos y Alabanza 🎸🎹

Una aplicación web diseñada para optimizar la organización, ensayo y ejecución de los tiempos de alabanza. Permite a los equipos de adoración gestionar su repertorio, asignar ensayos y sincronizar letras y acordes en tiempo real a través de múltiples pantallas.

## 🚀 Características Principales

* **Gestión de Roles:**
  * **Líder de Repaso:** Puede crear ensayos, asignar canciones del catálogo base, convocar a los integrantes y controlar el flujo del ensayo (Empezar, Pausar, Finalizar).
  * **Integrantes (General):** Pueden visualizar sus ensayos asignados y prepararse con anticipación.
* **Acordes Dinámicos por Instrumento:** Durante un ensayo, cada músico (guitarra, bajo, piano, etc.) puede adaptar y guardar sus propios acordes para una canción específica sin alterar el catálogo base original.
* **Sincronización Multipantalla (En desarrollo):** Integración nativa con `Window Management API` y `Broadcast Channel API` para proyectar y sincronizar letras/acordes en tiempo real durante la alabanza.

## 🏗️ Arquitectura del Proyecto

Este proyecto está construido utilizando **React** y **TypeScript**, aplicando estrictamente los principios de **Clean Architecture** y **Domain-Driven Design (DDD)** para asegurar la escalabilidad y el mantenimiento a largo plazo.

La estructura de carpetas está dividida en capas independientes:

* `core/domain/`: Contiene la lógica de negocio pura (Entidades como `Rehearsal`, `User`, `Song`) y los Puertos (Interfaces de repositorios). **Cero dependencias externas o de React.**
* `core/use-cases/`: Orquesta la lógica de la aplicación (ej. `StartRehearsalUseCase`, `UpdateCustomChordsUseCase`).
* `infrastructure/`: Implementación técnica de los puertos definidos en el dominio (conexión a Bases de Datos, APIs, servicios del navegador).
* `presentation/`: La capa visual con React (Componentes, Vistas y Custom Hooks).

## 🛠️ Tecnologías

* **Frontend:** React (v19+), TypeScript
* **Bundler:** Vite
* **Arquitectura:** Clean Architecture, DDD
* **Web APIs:** Broadcast Channel API, Window Management API

## 💻 Instalación y Uso

1. **Clona el repositorio:**
   ```bash
   git clone https://github.com/AHJimmy06/piba-alabanza.git
   cd piba-alabanza
   ```

2. **Instala las dependencias:**
   ```bash
   npm install
   ```

3. **Inicia el servidor de desarrollo:**
   ```bash
   npm run dev
   ```

4. **Para construir el proyecto para producción:**
   ```bash
   npm run build
   ```

## 📜 Licencia

Este proyecto es privado. Todos los derechos reservados.
