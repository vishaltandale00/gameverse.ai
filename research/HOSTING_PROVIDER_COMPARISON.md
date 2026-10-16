# Hosting provider comparison

Date: 2026-10-16 · Scope: shared browser-game hosting and disposable improvement execution. Prices are USD list-price calculations, not measured bills or performance benchmarks.

## Conclusion

AWS can host the complete product with managed services: ECS Fargate for the web service and improvement jobs, RDS PostgreSQL for the database, and S3 for durable files. Railway is an alternative application platform, not a required component of AWS. Daytona is an optional workspace service that can simplify agent integration. The architecture does not require two providers.

The earlier conversation mixed a self-managed Lightsail server/database with managed Fargate/RDS, and used an arbitrary $50 shared-hosting budget. The comparisons below identify the actual components and keep the modeled customer workload fixed. Operational effort is described by responsibility; there is no measured basis for the earlier maintenance-hours estimates.

## Fixed workload and limits of comparison

- 100 modeled customers, each retaining 5 GB of source, configs, artifacts, saves and evidence: 500 GB total.
- Each customer uses 30 billable improvement hours/month. Each job requests 2 vCPUs, 4 GiB RAM and 20 GiB temporary disk. Jobs upload results and terminate; there is no persistent per-user workspace disk.
- The shared application runs throughout a 720-hour month. The game itself runs in the browser. A single app instance and a single database instance are used for this pilot model; no app or database high availability is priced.
- For Railway, assume 1 GB app RAM plus 1 GB database RAM, 0.25 combined average vCPU use, and a 20 GB database volume. CPU use is an assumption, not a measurement. Railway bills usage, while AWS Fargate/RDS have different reserved/burstable capacity models.
- For managed AWS, use an app Fargate task with 0.5 vCPU/1 GiB, RDS PostgreSQL db.t4g.micro with 1 GiB and 20 GiB gp3, and an HTTPS Application Load Balancer. Linux/x86 Fargate and US East prices are used. The ARM-based RDS instance is a separate managed database, not an assumption that the game toolchain supports ARM.

These are alternative small configurations for the same proposed workload, not proven equal performance or a claim that either configuration supports 100 active players. Measure actual RAM, CPU, concurrency and startup/build/evaluation time before sizing production. Equal billable job hours are assumed; different runtime performance would change the comparison.

## What each setup contains

| Setup | Shared app and database | Improvement execution | What it buys |
| --- | --- | --- | --- |
| Railway plus Daytona Cloud | Railway Node service, PostgreSQL template and bucket | Daytona-hosted disposable sandbox | Application deployment defaults plus a workspace SDK; two providers |
| Managed AWS plus Daytona Cloud | ECS Fargate web service, ALB, RDS and S3 | Daytona-hosted disposable sandbox | AWS hosts the product; Daytona supplies workspace features; two providers |
| Managed AWS only | Same ECS Fargate web service, ALB, RDS and S3 | Standalone ECS Fargate task per improvement | All application data/compute on AWS; our worker implements the run protocol |
| AWS with Daytona BYOC | AWS app/database/storage plus a custom Daytona region | Daytona runners inside our AWS account | Daytona control plane over our compute; sales-assisted deployment and custom economics |
| Lightsail server plus Fargate | Node and self-managed PostgreSQL on one Lightsail VM, plus S3 | Standalone Fargate task | Lower shared cost with OS/database maintenance and a shared failure point |

ECS explicitly supports standalone tasks that do work and stop, and Fargate manages their underlying compute capacity. RDS manages provisioning, patching, automated backups and related database infrastructure tasks. [ECS standalone tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html), [RDS features](https://aws.amazon.com/rds/features/)

## Cost calculation

### Shared product hosting

| Monthly component | Railway | Managed AWS |
| --- | ---: | ---: |
| Web app and database compute | $25.00: 2 GB RAM at $10/GB-month plus 0.25 average vCPU at $20/vCPU-month | $17.77 app task plus $11.52 RDS db.t4g.micro |
| Database disk | $3.00: 20 GB at $0.15/GB-month | $2.30: 20 GB gp3 at $0.115/GB-month |
| 500 GB durable objects | $7.50 at $0.015/GB-month | $11.50 at $0.023/GB-month in S3 Standard |
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

All rows use the shared hosting model above and 100 customers. Amounts are rounded after calculation.

| Improvement hours per customer | Railway plus Daytona | Managed AWS plus Daytona | Managed AWS plus Fargate jobs |
| --- | ---: | ---: | ---: |
| 0 | $0.36 | $0.76 | $0.76 |
| 10 | $2.03 | $2.44 | $1.80 |
| 30 | **$5.39** | **$5.79** | **$3.87** |
| 100 | $17.13 | $17.53 | $11.13 |

Example: managed AWS at 30 job hours is ($75.8532 / 100) + (30 × $0.10374) = $3.870732/customer, or $387.07 total for 100 customers. With the same AWS backend, Daytona instead of Fargate adds about $1.92/customer for 30 job hours. That premium purchases platform features and is not a measured estimate of engineering time saved.

These are component subtotals, not all-in operating costs. Excluded: model usage paid through customer credentials, transcription, request/data-transfer/CDN charges, registry/image storage, logs/monitoring, secrets/KMS, extra backup storage, domain/DNS, taxes, payments and engineering/support labor. No trial credits, startup grants, Spot or commitments are assumed. ALB capacity units are explicitly modeled; other usage remains unpriced. Railway's bucket egress is currently free, whereas S3 and cross-provider traffic require their own calculation.

## Operational responsibilities

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

Vishal selected **managed AWS hosting plus Daytona Cloud coding and verification jobs** on 2026-10-16. The [hosting plan](../plans/HOSTING.md) is the current implementation direction. The choice favors ready-made sandbox/workspace APIs for quickly preparing an environment, coding, building, verifying and submitting work; interactive sessions are optional. Durable source/artifacts remain in S3, with no persistent sandbox per user. The modeled cost is $5.79/customer at 100 customers and 30 job hours each, before excluded items.

Direct Fargate coding jobs remain a lower resource-cost alternative, approximately $1.92/customer less at 30 job hours under the same AWS hosting assumptions. That difference is not a measured estimate of engineering time saved. Railway is outside the selected stack. Daytona BYOC remains a separate commercial/operations option, not a presumed shortcut to public Fargate rates with Daytona features.

The first qualification should use one pinned Linux toolchain and the real harness: source hydration, requested source change, build, supported play/simulation checks, candidate upload, cancellation/failure cleanup, sandbox deletion and a later run reconstructed from durable state. Compare identical inputs and record billable resources, queue/total/stage timings and failures before setting customer allowances. This comparison is research evidence, not a deployed configuration; the hosting plan and issue #16 carry the selected direction.
