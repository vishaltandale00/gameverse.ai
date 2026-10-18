# Hosting provider comparison

Updated: 2026-10-17 (Cloudflare selection/rates); AWS/Railway reference rates retain their 2026-10-16 verification date. Scope: shared browser-game hosting and disposable improvement execution. Prices are USD list-price calculations, not measured bills or performance benchmarks.

## Conclusion

The selected stack is **Cloudflare Workers + SQLite-backed Durable Objects + R2, with Daytona Cloud for disposable coding and verification jobs**. D1 can hold shared account/project listings where needed. One project object owns version/run metadata and coordinates external jobs through short handlers, callbacks and recovery alarms; files remain in R2 and native tools run in Daytona. See the [hosting plan](../plans/HOSTING.md) for the current architecture and setup.

Cloudflare replaces the earlier selected Fargate/ALB/RDS/S3 product hosting. It removes server/database-instance management but requires adapting the existing local Node server to Workers and partitioning metadata by project. AWS remains a conventional container/PostgreSQL alternative; Railway remains an application-platform alternative. These are choices, not layers required underneath Cloudflare or Daytona Cloud.

The earlier conversation also mixed self-managed Lightsail with managed Fargate/RDS and used an arbitrary $50 hosting budget. The historical alternatives below retain explicit components. No measured maintenance-hours or equal-performance claim follows from these cost tables.

## Fixed workload and limits of comparison

- 100 modeled customers, each retaining 5 GB of source, configs, artifacts, saves and evidence: 500 GB total.
- Each customer uses 30 billable improvement hours/month. Each job requests 2 vCPUs, 4 GiB RAM and 20 GiB temporary disk. Jobs upload results and terminate; there is no persistent per-user workspace disk.
- Browser gameplay runs on the client. Cloudflare hosting is event-driven; the $5 Workers account subscription, included usage and 500 GB-month R2 storage are modeled below. AWS/Railway examples retain their 720-hour app/database pilot assumptions, with no app/database high availability priced.
- For Railway, assume 1 GB app RAM plus 1 GB database RAM, 0.25 combined average vCPU use, and a 20 GB database volume. CPU use is an assumption, not a measurement. Railway bills usage, while AWS Fargate/RDS have different reserved/burstable capacity models.
- For managed AWS, use an app Fargate task with 0.5 vCPU/1 GiB, RDS PostgreSQL db.t4g.micro with 1 GiB and 20 GiB gp3, and an HTTPS Application Load Balancer. Linux/x86 Fargate and US East prices are used. The ARM-based RDS instance is a separate managed database, not an assumption that the game toolchain supports ARM.

These are alternative small configurations for the same proposed workload, not proven equal performance or a claim that any configuration supports 100 active players. Measure actual RAM, CPU, concurrency and startup/build/evaluation time before sizing production. Equal billable job hours are assumed; different runtime performance would change the comparison.

## What each setup contains

| Setup | Shared app and database | Improvement execution | What it buys |
| --- | --- | --- | --- |
| **Cloudflare plus Daytona Cloud (selected)** | Workers/Static Assets, project Durable Objects, optional D1 account index and R2 | Daytona-hosted disposable sandbox | Event-driven hosting and a workspace SDK; two providers |
| Railway plus Daytona Cloud | Railway Node service, PostgreSQL template and bucket | Daytona-hosted disposable sandbox | Application deployment defaults plus a workspace SDK; two providers |
| Managed AWS plus Daytona Cloud | ECS Fargate web service, ALB, RDS and S3 | Daytona-hosted disposable sandbox | AWS hosts the product; Daytona supplies workspace features; two providers |
| Managed AWS only | Same ECS Fargate web service, ALB, RDS and S3 | Standalone ECS Fargate task per improvement | All application data/compute on AWS; our worker implements the run protocol |
| AWS with Daytona BYOC | AWS app/database/storage plus a custom Daytona region | Daytona runners inside our AWS account | Daytona control plane over our compute; sales-assisted deployment and custom economics |
| Lightsail server plus Fargate | Node and self-managed PostgreSQL on one Lightsail VM, plus S3 | Standalone Fargate task | Lower shared cost with OS/database maintenance and a shared failure point |

ECS explicitly supports standalone tasks that do work and stop, and Fargate manages their underlying compute capacity. RDS manages provisioning, patching, automated backups and related database infrastructure tasks. [ECS standalone tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html), [RDS features](https://aws.amazon.com/rds/features/)

## Cost calculation

### Selected Cloudflare hosting baseline

At 100 customers retaining 5 GB each:

```text
Workers Paid subscription = $5/month
R2 Standard = (500 GB-month − 10 included) × $0.015 = $7.35/month
Cloudflare baseline = $12.35/month = $0.1235/customer
Daytona = 30 × $0.16776 = $5.0328/customer
Combined baseline = $5.1563/customer = $515.63/month for 100 customers
```

Assume the account's included allowances remain available: Workers 10 million requests/30 million CPU-ms; Durable Objects 1 million requests/400,000 GB-s; object SQLite 5 GB-month/25 billion rows read/50 million rows written; optional D1 its own 5 GB/25 billion reads/50 million writes; R2 1 million Class A/10 million Class B operations monthly. These are account-wide allowances, not per-customer entitlements. Usage overages, billing-unit rounding and the hosting plan's exclusions must be added. This is not a measured bill or all-in cap.

Durable Object duration is wall time while active or unable to hibernate. Do not keep an object waiting on a full coding job: persist intent/provider identity, return, and use callbacks plus sparse recovery alarms. Alarms may repeat and have finite built-in retries. Request deduplication, launch reconciliation and bounded cleanup remain application responsibilities. Large files stay in R2 rather than the object's SQLite storage. R2 Standard internet egress is free; operations remain metered. [Workers/D1 rates](https://developers.cloudflare.com/workers/platform/pricing/), [object billing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [R2 rates](https://developers.cloudflare.com/r2/pricing/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

Cloudflare also offers Linux sandbox containers, making an all-Cloudflare executor possible. It is outside the selected initial stack: qualify an equivalent full harness job, resource footprint, runtime constraints and lifecycle billing before comparing it with Daytona. A Durable Object by itself is not the native compiler/verification runtime. [Cloudflare Sandboxes](https://developers.cloudflare.com/sandbox/)

### Historical AWS and Railway shared hosting alternatives

| Monthly component | Railway | Managed AWS |
| --- | ---: | ---: |
| Web app and database compute | $25.00: 2 GB RAM at $10/GB-month plus 0.25 average vCPU at $20/vCPU-month | $17.77 app task plus $11.52 RDS db.t4g.micro |
| Database disk | $3.00: 20 GB at $0.15/GB-month | $2.30: 20 GB gp3 at $0.115/GB-month |
| 500 GB retained files | $7.50 at $0.015/GB-month | $11.50 at $0.023/GB-month in S3 Standard |
| Application task public IPv4 | Included within the application platform pricing | $3.60 for 720 hours |
| HTTPS/load balancing | Included within the application platform pricing | $16.20 ALB hourly charge plus $7.20 for two public IPv4 addresses |
| ALB capacity units | No separate ALB component | $5.76 assuming one average LCU; actual usage can differ |
| **Modeled shared subtotal** | **$35.50/month** | **$75.85/month** |

Railway's Pro $20 minimum includes $20 of resource usage; it is not an additional $20 on this subtotal. The AWS design uses a public subnet and restricted inbound access for app tasks; there is no NAT gateway in this model. The RDS instance remains private. A private-subnet NAT design, additional replicas, larger database or different ingress architecture changes the bill.

Sources: [Railway plans and resource rates](https://docs.railway.com/pricing/plans), [Railway bucket pricing](https://docs.railway.com/storage-buckets), [Railway public networking](https://docs.railway.com/networking/public-networking), [AWS component rates and source catalog evidence](HOSTING_AWS_COMPARISON.md).

### Disposable improvement jobs

| Component | Daytona Cloud | AWS Fargate |
| --- | ---: | ---: |
| 2 vCPUs | $0.1008/hour | $0.08096/hour |
| 4 GiB RAM | $0.0648/hour | $0.01778/hour |
| 20 GiB temporary disk | $0.00216/hour, ignoring free allowances | Included |
| Task public IPv4 for outbound access | No separate IP charge assumed in this model | $0.005/hour |
| **Modeled job rate** | **$0.16776/hour** | **$0.10374/hour** |
| **30 job hours per customer** | **$5.03/month** | **$3.11/month** |

Sources: [Daytona rates](https://www.daytona.io/pricing), [Daytona reserved-resource billing](https://www.daytona.io/docs/en/billing/), [Fargate prices and included storage](https://aws.amazon.com/fargate/pricing/), [AWS public IPv4 rate](https://aws.amazon.com/vpc/pricing/).

Both job estimates include time waiting for model responses while allocated resources remain billable. Include startup, image/source transfer, failed/cancelled attempts, verification, output upload and termination. Sum hours across additional parallel simulation workers. Use the actual allocation lifecycle and billing minimums when implementing accounting; neither compute model guarantees a particular game-build latency.

### Combined monthly cost per customer

All rows use 100 customers and the corresponding shared hosting models above. Cloudflare assumes usage within its included account allowances; add overages. Amounts are rounded after calculation.

| Improvement hours per customer | Cloudflare plus Daytona (selected baseline) | Railway plus Daytona | Managed AWS plus Daytona | Managed AWS plus Fargate jobs |
| --- | ---: | ---: | ---: | ---: |
| 0 | $0.12 | $0.36 | $0.76 | $0.76 |
| 10 | $1.80 | $2.03 | $2.44 | $1.80 |
| 30 | **$5.16** | **$5.39** | **$5.79** | **$3.87** |
| 100 | $16.90 | $17.13 | $17.53 | $11.13 |

Example: managed AWS at 30 job hours is ($75.8532 / 100) + (30 × $0.10374) = $3.870732/customer, or $387.07 total for 100 customers. With the same AWS backend, Daytona instead of Fargate adds about $1.92/customer for 30 job hours. That premium purchases platform features and is not a measured estimate of engineering time saved.

These are component subtotals, not all-in operating costs. Excluded: model usage paid through customer credentials, transcription, request/data-transfer/CDN charges, registry/image storage, logs/monitoring, secrets/KMS, extra backup storage, domain/DNS, taxes, payments and engineering/support labor. No trial credits, startup grants, Spot or commitments are assumed. ALB capacity units are explicitly modeled in AWS. Cloudflare usage within allowances and R2 free internet egress are explicit baseline inputs, with overages added separately. Railway bucket egress is free under the cited pricing, whereas S3 transfer needs its own calculation.

## Operational responsibilities

For the selected Cloudflare stack, Cloudflare operates runtime/object/storage infrastructure. We own authorization, bindings, SQLite/D1 migrations and queries, R2 retention, data export/restore validation, rollout, observability and correct run/activation state. Account indexes and project state are not one cross-object transaction. Persist accepted state in the owning object and reconcile secondary indexes or orphaned file uploads. This is less infrastructure to configure than the AWS reference, with more dependence on Cloudflare's runtime and storage APIs.

The remaining table compares historical alternatives:

| Responsibility | Railway platform and supported PostgreSQL template | AWS Fargate and RDS | Self-managed Lightsail VM and PostgreSQL |
| --- | --- | --- | --- |
| Underlying host/OS infrastructure | Railway | AWS | AWS physical host; we patch/configure the guest OS |
| Database infrastructure and security updates | Railway within its documented template support scope | RDS | We manage PostgreSQL installation, patches and recovery |
| HTTPS and app routing | Platform defaults | Configure ALB, certificate and networking | Configure reverse proxy/TLS or an additional service |
| Database backups and failover | We enable/configure backup/PITR/HA features | We configure RDS retention, maintenance and Single/Multi-AZ policy | We build and operate backup/restore and optional replication |
| Schema, queries, migrations and restore validation | Us | Us | Us |
| Application images, rollout, IAM/access, monitoring and incident response | Us, with platform abstractions | Us, with AWS service configuration | Us, including OS/database operations |
| Improvement request integrity, candidate validation and save protection | Us regardless of sandbox provider | Us regardless of sandbox provider | Us regardless of sandbox provider |

Railway's current documentation explicitly lists which database tasks it manages, including template image security patches, and which the user enables or owns. Customizing outside that support scope changes the boundary. RDS does not remove application schema, query or recovery-policy responsibility. [Railway database responsibilities](https://docs.railway.com/databases#what-railway-manages), [RDS features](https://aws.amazon.com/rds/features/)

Fargate replaces the need to operate sandbox hosts, but it is a container-job runtime. We package the harness as a worker that loads inputs, reports progress, uploads results and exits, and integrate task launch/status/cancel/reconciliation. Daytona supplies process/session, filesystem, preview and other workspace APIs. Whether those reduce work depends on which APIs Shishir's harness actually needs; a batch worker may need very little remote workspace API surface. Both approaches still need durable project state and a safe candidate/activation contract. [Daytona process execution](https://www.daytona.io/docs/en/process-code-execution/), [Daytona filesystem](https://www.daytona.io/docs/en/file-system-operations/)

Fargate does not reproduce Daytona's protected-secret substitution automatically. A direct AWS design must choose how the worker obtains model access and whether a credential proxy is required to keep plaintext out of agent-generated code. This integration/security work belongs in the comparison even though the resource table cannot price it. [Daytona protected secrets](https://www.daytona.io/docs/en/secrets/)

No provider can be assigned a defensible fixed number of maintenance hours from these public documents. Compare actual setup work, upgrades and recovery drills on the chosen deployment, rather than treating earlier rough hours as evidence.

## What using these services through AWS means

1. **Calling a hosted service from AWS:** an AWS-hosted backend can call Daytona Cloud's API. That still uses Daytona's hosted compute, bill and operating boundary.
2. **Buying through AWS Marketplace:** purchasing/billing is separate from compute placement. Railway documents a standard $10,000, 12-month Marketplace contract with usage entitlements and overages. It is not the ordinary Pro minimum simply appearing on an AWS bill, and those contract terms do not establish deployment inside our AWS account. [Railway Marketplace terms](https://docs.railway.com/pricing/aws-marketplace)
3. **Running vendor software over our AWS compute:** Daytona BYOC deploys a custom region with runner infrastructure in our account while retaining Daytona's control plane. Its official AWS Helm chart describes this split; the docs describe sales-assisted setup. Public Cloud hourly rates do not establish the BYOC platform fee or runner economics. [Daytona AWS BYOC chart](https://github.com/daytonaio/helm-charts/blob/main/charts/daytona-region/README.md)

Railway lists Bring Your Own Cloud under its custom Enterprise offering, but the public listing does not specify an AWS topology or public price. An AWS-specific deployment needs commercial/technical confirmation. It should not be assumed to be available at Pro rates. [Railway Enterprise feature listing](https://railway.com/pricing)

## Selected direction after review

Vishal selected **Cloudflare Workers, Durable Objects and R2 plus Daytona Cloud coding and verification jobs** on 2026-10-17, superseding the AWS hosting choice made the previous day. The [hosting plan](../plans/HOSTING.md) and [issue #16](https://github.com/vishaltandale00/gameverse.ai/issues/16) carry that direction. Durable source/artifacts remain in R2; no persistent sandbox per user is needed. The baseline at 100 customers and 30 job-hours each is **$5.16/customer**, before Cloudflare overages and excluded items, compared with the previous AWS + Daytona model's $5.79.

Direct Fargate coding jobs, Railway, Daytona BYOC and Cloudflare sandbox containers remain alternatives. Compare complete equivalent workloads, not nominal startup or isolated hourly prices. These research tables do not authorize deployment or certify runtime capacity.

The first integration should use the public reference fixture: durable request → disposable Daytona job → R2 outputs → validated candidate receipt → deletion, including object restart and reconstruction from retained state. Then qualify native compilation, a real source/mechanics change, supported play/simulation verification, cancellation/failure cleanup and safe host activation. Record billable resources, queue/total/stage timings and failures before setting commercial allowances.
