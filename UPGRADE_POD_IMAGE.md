# How to Upgrade Pod Image in MicroK8s

This guide explains how to update the container image of an existing Deployment in a **MicroK8s** environment.

---

## 1. Copy the Image Tarball to the Server
Build and export the image on your local machine:

```bash
docker build --platform=linux/amd64 -t ndm-reports-service:09092025_v5 .
docker save -o ndm-reports-service-29082025.tar ndm-reports-service:09092025_v5
```

Transfer the `.tar` file to the server using `scp`:

```bash
gcloud compute scp ndm-reports-service-29082025.tar user@<server-ip>:~
```

---

## 2. Import Image into MicroK8s
On the server, import the image into the MicroK8s container runtime:

```bash
microk8s images import ndm-reports-service-29082025.tar
```

Verify import:

```bash
microk8s ctr images ls | grep ndm-reports-service
```

---

## 3. Check Current Deployment Image
Find out which image your Deployment is currently running:

```bash
kubectl get deployment reports-service \
  -o=jsonpath='{.spec.template.spec.containers[*].image}' \
  -n datamigrator
```

---

## 4. Update Deployment to Use the New Image
Update the Deployment to the new image tag:

```bash
kubectl set image deployment/reports-service \
  reports-service=ndm-reports-service:09092025_v5 \
  -n datamigrator
```

---

## 5. Monitor Rollout
Check the status of the rollout:

```bash
kubectl rollout status deployment/reports-service -n datamigrator
```

---

## 6. Verify the Update
Confirm that the Deployment now points to the new image:

```bash
kubectl get deployment reports-service \
  -o=jsonpath='{.spec.template.spec.containers[*].image}' \
  -n datamigrator
```

You should see:

```
ndm-reports-service:09092025_v5
```

---

## Notes
- If rollout fails, you can undo with:
  ```bash
  kubectl rollout undo deployment/reports-service -n datamigrator
  ```
- Always ensure your image is imported into MicroK8s before updating the Deployment.
