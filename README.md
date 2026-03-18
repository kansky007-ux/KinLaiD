# 🍜 LunchDrop — Setup Guide

## โครงสร้างโปรเจกต์

```
restaurant-app/
├── frontend/
│   ├── index.html       ← UI (Vanilla JS)
│   ├── nginx.conf       ← Nginx config (proxy /api/ → backend)
│   └── Dockerfile
├── backend/
│   ├── index.js         ← Express app entry
│   ├── routes/
│   │   ├── restaurants.js  ← CRUD + bcrypt delete code
│   │   └── admin.js        ← Admin routes (require x-admin-key)
│   ├── db/
│   │   ├── pool.js      ← PostgreSQL connection pool
│   │   └── schema.sql   ← Table definitions + seed data
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/restaurants` | ดึงร้านทั้งหมด (`?search=&type=`) |
| POST | `/api/restaurants` | เพิ่มร้าน → คืน `delete_code` |
| DELETE | `/api/restaurants/:id` | ลบด้วย code (body: `{ code }`) |
| GET | `/api/restaurants/random` | สุ่มร้าน (`?type=`) |
| GET | `/api/admin/restaurants` | Admin: ดึงทั้งหมด |
| DELETE | `/api/admin/restaurants/:id` | Admin: ลบโดยไม่ต้อง code |
| GET | `/api/admin/stats` | Admin: สถิติ |

Admin routes ต้องส่ง header: `x-admin-key: YOUR_KEY`

---

## รันบน Docker (Development)

```bash
# 1. Clone / copy โปรเจกต์
cd restaurant-app

# 2. สร้าง .env
cp .env.example .env
# แก้ DB_PASSWORD และ ADMIN_KEY ใน .env

# 3. Build & Run
docker compose up --build

# เข้าเว็บ:   http://localhost
# API:        http://localhost:4000/api/health
# Admin page: http://localhost/?admin=YOUR_ADMIN_KEY
```

---

## Deploy บน Proxmox → Docker → k3s

### 1. Push images ขึ้น registry (ถ้ามี)

```bash
# Build
docker build -t lunchdrop-backend:latest ./backend
docker build -t lunchdrop-frontend:latest ./frontend

# Push (ถ้าใช้ local registry บน Proxmox)
docker tag lunchdrop-backend:latest registry.local:5000/lunchdrop-backend:latest
docker push registry.local:5000/lunchdrop-backend:latest

docker tag lunchdrop-frontend:latest registry.local:5000/lunchdrop-frontend:latest
docker push registry.local:5000/lunchdrop-frontend:latest
```

### 2. k3s manifests

สร้างไฟล์ `k3s/namespace.yaml`:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: lunchdrop
```

สร้างไฟล์ `k3s/secret.yaml`:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: lunchdrop-secret
  namespace: lunchdrop
type: Opaque
stringData:
  DB_PASSWORD: "your_secure_password"
  ADMIN_KEY:   "your_admin_key"
```

สร้างไฟล์ `k3s/postgres.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: lunchdrop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:16-alpine
        env:
        - name: POSTGRES_DB
          value: lunchdrop
        - name: POSTGRES_USER
          value: postgres
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: lunchdrop-secret
              key: DB_PASSWORD
        ports:
        - containerPort: 5432
        volumeMounts:
        - name: pgdata
          mountPath: /var/lib/postgresql/data
      volumes:
      - name: pgdata
        persistentVolumeClaim:
          claimName: postgres-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: lunchdrop
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: lunchdrop
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 2Gi
```

สร้างไฟล์ `k3s/backend.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: lunchdrop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: registry.local:5000/lunchdrop-backend:latest
        env:
        - name: DB_HOST
          value: postgres
        - name: DB_NAME
          value: lunchdrop
        - name: DB_USER
          value: postgres
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: lunchdrop-secret
              key: DB_PASSWORD
        - name: ADMIN_KEY
          valueFrom:
            secretKeyRef:
              name: lunchdrop-secret
              key: ADMIN_KEY
        - name: NODE_ENV
          value: production
        ports:
        - containerPort: 4000
        livenessProbe:
          httpGet:
            path: /api/health
            port: 4000
          initialDelaySeconds: 15
          periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: lunchdrop
spec:
  selector:
    app: backend
  ports:
  - port: 4000
    targetPort: 4000
```

สร้างไฟล์ `k3s/frontend.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: lunchdrop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: registry.local:5000/lunchdrop-frontend:latest
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: lunchdrop
spec:
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: lunchdrop-ingress
  namespace: lunchdrop
  annotations:
    kubernetes.io/ingress.class: traefik   # k3s ใช้ traefik by default
spec:
  rules:
  - host: lunch.local                       # ← เปลี่ยนเป็น domain ของคุณ
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port:
              number: 80
```

### 3. Apply ทั้งหมด

```bash
kubectl apply -f k3s/namespace.yaml
kubectl apply -f k3s/secret.yaml
kubectl apply -f k3s/postgres.yaml
kubectl apply -f k3s/backend.yaml
kubectl apply -f k3s/frontend.yaml

# ดู status
kubectl get pods -n lunchdrop
kubectl get svc   -n lunchdrop
```

---

## Security Notes

- `delete_code` เก็บเป็น bcrypt hash ใน DB — ถ้า DB หลุด codes ก็ยังปลอดภัย
- Admin routes ต้องส่ง `x-admin-key` header — ไม่มีปุ่มบน UI
- Rate limit: เพิ่มร้าน 20 ครั้ง/ชั่วโมง, ลบ 10 ครั้ง/ชั่วโมง ต่อ IP
- Brute force guard: ลองผิด 5 ครั้ง/ชั่วโมง ต่อ IP ต่อร้าน → block
