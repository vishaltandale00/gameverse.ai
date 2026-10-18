# Managed AWS hosting cost reference

Status as of 2026-10-17: historical comparison alternative. The selected [hosting plan](../plans/HOSTING.md) now uses Cloudflare Workers, Durable Objects and R2 plus Daytona Cloud. AWS rates below retain their original verification date; they are not required infrastructure for that plan.

Verified 2026-10-16. This is a pricing model, not a deployed or load-tested configuration. USD, `us-east-1`, on-demand pricing, a 30-day/720-hour month, no credits, free trials, commitments, taxes, or paid support. Prices and service capabilities are primary-source verified except the explicitly qualified NAT regional estimate below.

## Consistent configuration

The reference is **ECS Fargate + RDS PostgreSQL + S3**, rather than a VM running a self-managed database. The always-on application requests 0.5 x86 vCPU and 1 GiB RAM. PostgreSQL uses a Single-AZ `db.t4g.micro` with 1 GiB RAM and 20 GiB gp3 storage. Thus the application and database together have 2 GiB RAM. These allocations establish a comparable cost example; they do not prove sufficient production capacity. The database's 2 burstable vCPUs and the application's reserved 0.5 vCPU should not be described as equivalent to another provider's average CPU consumption billing. [RDS catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.json), [Fargate catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-1/index.json).

Improvement jobs request 2 x86 vCPU, 4 GiB RAM, and the default 20 GiB temporary storage. At 100 users × 30 task-hours/user/month, aggregate usage is 3,000 task-hours. There is no permanently allocated per-user filesystem. The 500 GB S3 assumption is total retained artifact storage across users, separate from database and task disks. Model-provider charges are separate.

## Published resource rates

The regional public AWS catalogs were read directly and filtered by product attributes, engine, deployment, architecture, and usage type. Listed SKUs make the extraction reproducible.

| Resource | Verified rate | Catalog SKU / source |
|---|---:|---|
| Fargate Linux/x86 CPU | $0.04048/vCPU-hour | `8CESGAFWKAJ98PME`, [ECS catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-1/index.json) |
| Fargate Linux/x86 memory | $0.004445/GiB-hour | `PBZNQUSEXZUC34C9`, same catalog |
| Fargate additional temporary storage | $0.000111/GiB-hour above included 20 GiB | `7KPDPTDSCT4J3Z64`, same catalog |
| PostgreSQL `db.t4g.micro`, Single-AZ | $0.016/hour | `9HPEGXQTDDGH53C9`, [RDS catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.json) |
| PostgreSQL `db.t4g.small`, Single-AZ, 2 GiB RAM | $0.032/hour | `S9H3AXMBHSKRFJTA`, same catalog |
| PostgreSQL Single-AZ gp3 storage | $0.115/GiB-month | `KYVYY29G957PKY3B`, same catalog |
| S3 Standard, first 50 TB | $0.023/GB-month | `WP9ANXZGBYYSGJEA`, [S3 catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json) |
| In-use public IPv4 | $0.005/address-hour | `4GQUNXTFWVSGPUZK`, [VPC catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/us-east-1/index.json) |
| Application Load Balancer | $0.0225/hour + $0.008/used LCU-hour | `37CUWUT8GSNQEPUV`, `P2XGEJ8N3KU52WA8`, [ELB catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/us-east-1/index.json) |

Catalog publication timestamps: ECS 2026-09-11; RDS 2026-10-06; S3 2026-10-15; VPC 2026-09-17; ELB 2026-09-11. These are catalog publication dates, not a claim that each rate changed then.

Fargate charges requested resources from image download through task termination, per second with a one-minute Linux minimum. Its default temporary storage has no separate storage charge. A 20 GiB PostgreSQL gp3 volume includes baseline 3,000 IOPS/125 MiB/s; the example does not provision additional performance. T4g database CPU above its rolling baseline can add $0.075/vCPU-hour. [Fargate billing](https://aws.amazon.com/fargate/pricing/), [RDS storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html), [RDS CPU credits](https://aws.amazon.com/rds/postgresql/pricing/).

## Monthly arithmetic

| Always-on component | Formula | Cost |
|---|---|---:|
| Application compute | `(0.5 × 0.04048 + 1 × 0.004445) × 720` | $17.7732 |
| Managed PostgreSQL compute | `0.016 × 720` | $11.52 |
| Database disk | `20 × 0.115` | $2.30 |
| Retained artifacts | `500 × 0.023` | $11.50 |
| Subtotal before networking/ingress | sum | **$43.0932** |
| Application public IPv4 | `1 × 0.005 × 720` | $3.60 |
| Subtotal with direct task internet access | sum | **$46.6932** |
| ALB fixed hourly component | `0.0225 × 720` | $16.20 |
| Minimum modeled ALB public IPv4 | `2 × 0.005 × 720` | $7.20 |
| **Application + database + S3 + ALB** | sum, before LCU usage | **$70.0932 + LCU** |
| Illustrative average one LCU | `1 × 0.008 × 720` | $5.76 |
| **Same base at one average LCU** | sum | **$75.8532** |

An ordinary regional ALB requires at least two Availability Zone subnets and has one address per enabled zone. Two public addresses are a minimum model; scaling may increase them. LCU is measured consumption, not a fixed compulsory one-LCU reservation. The one-LCU row is a sensitivity assumption, not a measured Gameverse workload. [ALB networking](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/).

| Improvement component | Formula | Cost |
|---|---|---:|
| One task's compute per hour | `2 × 0.04048 + 4 × 0.004445` | $0.09874 |
| 100 users' job compute | `3,000 × 0.09874` | $296.22 |
| Jobs' public IPv4 | `3,000 × 0.005` | $15.00 |
| **Improvement subtotal** | sum | **$311.22/month** |
| **Complete reference configuration** | base + improvement | **$381.3132 + LCU/month** |
| **With illustrative one average LCU** | base + improvement | **$387.0732/month** |

At 100 users, those last two totals allocate to **$3.8131/user/month + LCU allocation**, or **$3.8707/user/month with one average LCU**. They exclude the usage items below. The per-user figure allocates shared base infrastructure; it is not the marginal task cost. An upgrade to `db.t4g.small` adds $11.52/month and changes total reserved RAM from 2 GiB to 3 GiB.

## Network choices

For the initial model, tasks have public IPv4 addresses and internet-gateway routes. Restrict application inbound access to its ALB security group; jobs require no inbound listener. Keep RDS private. Public-subnet Fargate tasks can reach external model APIs directly, so this design does not require a NAT gateway. A public address alone does not require opening inbound ports. [Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html), [outbound network options](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html), [security-group rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html).

Private tasks with NAT are an alternative. AWS publishes a $0.045/hour + $0.045/GB NAT example, plus public IPv4 charges; **the retrieved price example is explicitly Ohio, so a Virginia NAT quote remains a verification gap**. At that rate, one always-on NAT with one IPv4 costs $36/month before processing and other transfer. Replacing $18.60 of app/job public-IP charges gives a $17.40/month net increase, producing $404.4732/month at one average ALB LCU. Two NATs would add $72 fixed instead of $36. These are conditional alternatives, not additions to the public-task baseline. Cross-zone routing can add transfer costs. S3 gateway endpoints avoid NAT traversal for S3 and have no hourly or processing charge. Private endpoints for AWS services do not by themselves provide access to an arbitrary external model API. [VPC pricing](https://aws.amazon.com/vpc/pricing/), [NAT guidance](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html).

## Management and job integration responsibilities

AWS provisions and patches the Fargate infrastructure; the team manages container images, application dependencies, network configuration, encryption choices, and task IAM roles. Each Fargate task has hardware-virtualized isolation from other tasks, including kernel, CPU, memory, network interface, and temporary storage. This supports a separate task per improvement job; it does not remove application-level credential or output handling responsibilities. [Fargate shared responsibility](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-shared-model.html).

RDS manages database installation, host OS and database patching, backup mechanisms, failure detection, and recovery. The team still selects capacity, backup retention, maintenance/upgrade policies, access rules, schema/migrations, query tuning, monitoring, and restore qualification. Single-AZ has no provisioned standby; this pilot is not a multi-AZ availability design. No defensible fixed number of monthly operations hours follows from these service descriptions. [RDS management model](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html), [RDS data protection responsibilities](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/DataDurability.html), [Single-AZ versus Multi-AZ](https://aws.amazon.com/rds/postgresql/pricing/).

ECS provides task start/stop APIs, command overrides, lifecycle status, and task events. **Proposed application work:** wrap those primitives with Gameverse's submission queue, concurrency/resource limits, cancellation, timeout enforcement, credential scoping, artifact upload, and durable run results. This is an integration estimate boundary, not an implemented requirement on the separately owned improvement algorithm. A dedicated sandbox product may package more of that application-facing interface; Fargate's compute quote alone does not price the engineering work. [RunTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html), [StopTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html), [task state events](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_task_events.html).

The default 20 GiB is shared with compressed/uncompressed image contents, so usable job workspace is smaller. Durable outputs must be copied out by the proposed runner. Injecting a raw model API key into an environment variable exposes it to applications in that container; an external credential broker or short-lived/scoped credential is an application design choice, not an automatic Fargate guarantee. [Temporary storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html), [secret environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html).

## Exclusions and qualification gaps

- Not included: internet asset delivery/CDN, S3 requests, logs/metrics, image registry storage, secret storage/API usage, KMS, excess backup/snapshot storage, cross-zone transfer, retries, rollout overlap, model calls, or support. Storage capacity is not a bandwidth allowance. These need traffic/retention assumptions before an all-in quote is defensible. [S3 pricing](https://aws.amazon.com/s3/pricing/), [Fargate additional charges](https://aws.amazon.com/fargate/pricing/).
- No deployment, run, build, job-start latency, throughput, or operational-duration baseline was measured. The 30 job-hours/user is an input assumption and must cover billable startup, work, retries, and shutdown if used as a budget.
- **Parked simpler AWS candidate:** Lightsail managed containers offer 1 GB/0.25 shared vCPU for $10/month, or 1 GB/0.5 shared vCPU for $15; the 1 GB managed database is $15 with 40 GB storage and no data encryption. Adding S3 at this assumption yields $36.50 or $41.50/month before extras. Containers include a TLS endpoint. Official WebSocket compatibility of the container endpoint was not established in this pass; this candidate is not qualified for the live-voice path and is not the main comparison. [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/), [managed container FAQ](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-containers.html).
