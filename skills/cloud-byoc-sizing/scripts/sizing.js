#!/usr/bin/env node
'use strict';

/**
 * Redpanda workload sizing calculator.
 *
 * Estimates the Redpanda Compute Units (RPUs) a Kafka workload needs and the
 * supported broker deployment that fits it, for one point in time or as a
 * projection over time. Zero dependencies; requires Node.js 18+.
 *
 * The sizing model (compute-unit capacities, instance catalog, CPU and IOPS
 * coefficients) lives in this file only. `--model` prints the capacities,
 * target utilizations, instance catalog and input defaults; the CPU and
 * Iceberg coefficients are constants in the methods below.
 * See ../references/ (agent guide) and ../README.md (human guide).
 *
 * Usage:
 *   node sizing.js --cloud AWS --ingress 50 --egress 150 --partitions 1000
 *                  [--latency 100] [--producers N] [--consumers N]
 *                  [--multi-az true|false]
 *   node sizing.js --cloud all ...        # compare AWS, GCP and Azure
 *   node sizing.js --input workloads.json # multiple workloads in one cluster
 *
 * Projection over time:
 *   node sizing.js --cloud AWS --ingress 50 --egress 150 --partitions 1000 \
 *                  --months 12 --monthly-growth 8 [--start 2026-11] [--format csv]
 *   node sizing.js --input plan.json       # { periods: [{label, workloads}] } or { workloads, growth }
 *
 * Model introspection:
 *   node sizing.js --model                 # compute units, instance catalog, defaults
 *
 * Output: JSON on stdout (CSV with --format csv in timeline mode). Exit code 1
 * with {"error": "..."} on invalid input.
 */

class Assert {
  static instanceOf(parameterName, parameterValue, clazz) {
    let isInstanceOf = false;
    if (clazz === Number && (parameterValue instanceof clazz || typeof parameterValue === 'number')) {
      isInstanceOf = true;
    } else if (clazz === Boolean && (parameterValue instanceof clazz || typeof parameterValue === 'boolean')) {
      isInstanceOf = true;
    } else if (clazz === String && (parameterValue instanceof clazz || typeof parameterValue === 'string')) {
      isInstanceOf = true;
    } else if (parameterValue instanceof clazz) {
      isInstanceOf = true;
    }
    if (!isInstanceOf) {
      const actual = parameterValue == null
        ? String(parameterValue)
        : parameterValue.constructor?.name || typeof parameterValue;
      throw new TypeError(`${parameterName} must be instance of ${clazz.name}; got ${actual}`);
    }
  }

  static true(expression, message = 'expression was not true.') {
    if (!expression) throw new Error(message);
  }

  static number(number) {
    if (!(typeof number === 'number' && isFinite(number))) {
      throw new TypeError(`${number} is not of type number.`);
    }
  }

  static integer(number) {
    Assert.number(number);
    if (!Number.isInteger(number)) throw new TypeError(`${number} is not an integer.`);
  }

  static notNull(parameterName, parameterValue) {
    if (typeof parameterName !== 'string') throw new Error(`parameter name should be a string.`);
    if (parameterValue === null || parameterValue === undefined) {
      throw new Error(`${parameterName} was not defined or was null.`);
    }
  }
}

class AbstractComputeUnit {
  constructor(name, disk_gb, network_gbps, riops, wiops, performance_score,
              ingress_mbps, egress_mbps, connections, partitions) {
    this.name              = name;
    this.disk_gb           = disk_gb;
    this.network_gbps      = network_gbps;
    this.riops             = riops;
    this.wiops             = wiops;
    this.performance_score = performance_score;
    this.ingress_mbps      = ingress_mbps;
    this.egress_mbps       = egress_mbps;
    this.connections       = connections;
    this.partitions        = partitions;

    Assert.notNull('name', name);
    [['disk_gb', disk_gb], ['network_gbps', network_gbps], ['riops', riops], ['wiops', wiops],
     ['performance_score', performance_score], ['ingress_mbps', ingress_mbps],
     ['egress_mbps', egress_mbps], ['connections', connections], ['partitions', partitions]]
      .forEach(([n, v]) => { Assert.notNull(n, v); Assert.number(v); });
  }
}

class AmazonComputeUnit extends AbstractComputeUnit {
  constructor() { super('AWS', 126.7, 0.9, 33542, 16771, 1.00, 16.67, 50.00, 1875, 667); }
}

class GoogleComputeUnit extends AbstractComputeUnit {
  constructor() { super('GCP', 603.98, 2.0, 150000, 75000, 0.81, 16.67, 50.00, 1875, 667); }
}

class AzureComputeUnit extends AbstractComputeUnit {
  constructor() { super('Azure', 80.5, 1.0, 9000, 9000, 1.05, 16.67, 50.00, 1875, 667); }
}

class Tunables {
  constructor(
    append_chunk              = 16384,
    fsync_ratio               = 1.0,
    batch_size_bytes          = 1e6,
    iceberg_compression_ratio = 1.0,
    // hardware utilization defaults to 80% to provide a 20% safety margin.
    target_utilization_override_cpu         = 0.8,
    target_utilization_override_iops        = 0.8,
    target_utilization_override_network     = 0.8,
    target_utilization_override_kafka_in    = 0.8,
    target_utilization_override_kafka_out   = 0.8,
    target_utilization_override_connections = 0.8,
  ) {
    this.append_chunk                            = append_chunk;
    this.fsync_ratio                             = fsync_ratio;
    this.batch_size_bytes                        = batch_size_bytes;
    this.iceberg_compression_ratio               = iceberg_compression_ratio;
    this.target_utilization_override_cpu         = target_utilization_override_cpu;
    this.target_utilization_override_iops        = target_utilization_override_iops;
    this.target_utilization_override_network     = target_utilization_override_network;
    this.target_utilization_override_kafka_in    = target_utilization_override_kafka_in;
    this.target_utilization_override_kafka_out   = target_utilization_override_kafka_out;
    this.target_utilization_override_connections = target_utilization_override_connections;

    Assert.integer(append_chunk);
    Assert.true(0 <= append_chunk);
    Assert.number(fsync_ratio);
    Assert.true(0 <= fsync_ratio && fsync_ratio <= 1);
    Assert.integer(batch_size_bytes);
    Assert.true(0 <= batch_size_bytes);
    Assert.number(iceberg_compression_ratio);
    Assert.true(0 <= iceberg_compression_ratio && iceberg_compression_ratio <= 1);

    const target_utilizations = [
      target_utilization_override_cpu,
      target_utilization_override_iops,
      target_utilization_override_network,
      target_utilization_override_kafka_in,
      target_utilization_override_kafka_out,
      target_utilization_override_connections
    ];
    target_utilizations.forEach(tu => Assert.number(tu));
    target_utilizations.forEach(tu => Assert.true(0 < tu && tu <= 1));
  }
}

class KafkaRequirement {
  constructor(ingress_mbps, egress_mbps, num_partitions, num_producers, num_consumers,
              message_size_bytes = 10000, replication_factor = 3, local_retention_mins = 30) {
    this.ingress_mbps         = ingress_mbps;
    this.num_partitions       = num_partitions;
    this.num_producers        = num_producers;
    this.num_consumers        = num_consumers;
    this.cp_ratio             = egress_mbps / ingress_mbps;
    this.message_size_bytes   = message_size_bytes;
    this.replication_factor   = replication_factor;
    this.local_retention_mins = local_retention_mins;

    // calculated properties
    this.ingress_bytes      = ingress_mbps * 1e6;
    this.egress_bytes       = egress_mbps  * 1e6;
    this.partition_replicas = num_partitions * replication_factor;

    Assert.number(ingress_mbps);
    Assert.number(egress_mbps);
    Assert.integer(num_partitions);
    Assert.integer(num_producers);
    Assert.integer(num_consumers);
    Assert.integer(message_size_bytes);
    Assert.integer(replication_factor);
    Assert.integer(local_retention_mins);

    Assert.true(0 < ingress_mbps, 'ingress must be > 0');
    Assert.true(0 < egress_mbps, 'egress must be > 0');
    Assert.true(0 < num_partitions, 'partitions must be > 0');
    Assert.true(0 < num_producers, 'producers must be > 0');
    Assert.true(0 < num_consumers, 'consumers must be > 0');
    Assert.true(0 < message_size_bytes, 'message size must be > 0');
    Assert.true(0 < replication_factor, 'replication factor must be > 0');
    Assert.true(0 < local_retention_mins, 'local retention must be > 0');

    // raft and replication require an odd number of replicas
    Assert.true(replication_factor % 2 > 0, 'replication factor must be odd');

    // max partition limit for a cluster is 112,500 partitions (not replicas).
    Assert.true(num_partitions <= 112500, 'max 112,500 partitions per cluster');
  }
}

class StorageRequirement {
  constructor(enabled = true) { this.enabled = enabled; }
}

class IcebergRequirement {
  constructor(num_schema_fields = -1) {
    this.enabled = num_schema_fields > 0;
    this.num_schema_fields = num_schema_fields;
  }
}

class AbstractLatencyRequirement {
  /* abstract */ calculateBatchSizeBytes(kafkaRequirement, tunables) {
    throw new Error("Method 'calculateBatchSizeBytes()' must be implemented.");
  }
  calculateBatchesPerSecond(kafkaRequirement, tunables) {
    const batch_size_bytes = this.calculateBatchSizeBytes(kafkaRequirement, tunables);
    return kafkaRequirement.ingress_bytes / batch_size_bytes;
  }
}

class TimeBasedLatencyRequirement extends AbstractLatencyRequirement {
  constructor(latency_target_ms = 100) {
    super();
    this.latency_target_ms = latency_target_ms;
    Assert.true(0 < latency_target_ms, 'latency target must be > 0');
  }
  calculateBatchSizeBytes(kafkaRequirement, tunables) {
    const effective_batch_size_bytes = Math.max(
      kafkaRequirement.message_size_bytes,
      kafkaRequirement.ingress_bytes * this.latency_target_ms / 1000 / kafkaRequirement.num_producers
    );
    return Math.min(tunables.batch_size_bytes, effective_batch_size_bytes);
  }
}

class SizeBasedLatencyRequirement extends AbstractLatencyRequirement {
  constructor(batch_size_bytes) {
    super();
    this.batch_size_bytes = batch_size_bytes;
  }
  calculateBatchSizeBytes(kafkaRequirement, tunables) {
    return this.batch_size_bytes;
  }
}

class Workload {
  constructor(latencyRequirement, kafkaRequirement,
              storageRequirement = new StorageRequirement(),
              icebergRequirement = new IcebergRequirement()) {
    Assert.instanceOf('latencyRequirement', latencyRequirement, AbstractLatencyRequirement);
    Assert.instanceOf('kafkaRequirement'  , kafkaRequirement  , KafkaRequirement);
    Assert.instanceOf('storageRequirement', storageRequirement, StorageRequirement);
    Assert.instanceOf('icebergRequirement', icebergRequirement, IcebergRequirement);
    this.latencyRequirement = latencyRequirement;
    this.kafkaRequirement   = kafkaRequirement;
    this.storageRequirement = storageRequirement;
    this.icebergRequirement = icebergRequirement;
  }

  wiops4Iceberg(tunables) {
    const ingress_bytes     = this.kafkaRequirement.ingress_bytes;
    const compression_ratio = tunables.iceberg_compression_ratio;
    return ingress_bytes / compression_ratio / 4096 * this.icebergRequirement.enabled;
  }

  riops4(tunables) {
    const egress_bytes  = this.kafkaRequirement.egress_bytes;
    const ingress_bytes = this.kafkaRequirement.ingress_bytes * this.storageRequirement.enabled;
    return (egress_bytes + ingress_bytes) / 4096 + this.wiops4Iceberg(tunables);
  }

  wiops4(tunables) {
    const kafkaRequirement   = this.kafkaRequirement;
    const latencyRequirement = this.latencyRequirement;
    const batchSize   = latencyRequirement.calculateBatchSizeBytes(kafkaRequirement, tunables);
    const batchWiops4 = (1 + (batchSize - 1) / 4096 + tunables.fsync_ratio) * kafkaRequirement.replication_factor;
    const kafka       = batchWiops4 * latencyRequirement.calculateBatchesPerSecond(kafkaRequirement, tunables);
    const iceberg     = this.wiops4Iceberg(tunables);
    return kafka + iceberg;
  }

  partitions() { return this.kafkaRequirement.num_partitions; }

  partitionReplicas() { return this.partitions() * this.kafkaRequirement.replication_factor; }

  cpuProduce(tunables) {
    Assert.notNull('tunables', tunables);
    const BATCH_PROD_MICROS = 0.0003644375;
    const bps = this.latencyRequirement.calculateBatchesPerSecond(this.kafkaRequirement, tunables);
    return bps * BATCH_PROD_MICROS;
  }

  cpuFetch(tunables) {
    Assert.notNull('tunables', tunables);
    return this.cpuProduce(tunables) / 3 * this.kafkaRequirement.cp_ratio;
  }

  cpuIceberg(tunables) {
    if (this.icebergRequirement.enabled == false) return 0.0;
    const ICEBERG_B0 = 33.65;
    const ICEBERG_B1 = 1.19;
    const ICEBERG_B2 = -0.02;
    const ICEBERG_FF = 3.7231;
    const numFields        = Math.max(1, this.icebergRequirement.num_schema_fields);
    const ingressBytes     = this.ingressBytesWithoutReplication();
    const messageSizeBytes = this.kafkaRequirement.message_size_bytes;
    const b1 = numFields * ICEBERG_B1;
    const b2 = messageSizeBytes * ICEBERG_B2;
    return ingressBytes * ICEBERG_FF * (ICEBERG_B0 + b1 + b2) / 1000 / 1e6;
  }

  cpu(tunables) {
    Assert.notNull('tunables', tunables);
    return this.cpuProduce(tunables) + this.cpuFetch(tunables) + this.cpuIceberg(tunables);
  }

  ingressBytesWithReplication() {
    return this.kafkaRequirement.ingress_bytes * this.kafkaRequirement.replication_factor;
  }

  ingressBytesWithoutReplication() { return this.kafkaRequirement.ingress_bytes; }

  egressBytes(tunables) {
    Assert.notNull('tunables', tunables);
    const rf = this.kafkaRequirement.replication_factor;
    const ts = this.storageRequirement.enabled;
    const ib = this.icebergRequirement.enabled;
    return this.kafkaRequirement.egress_bytes +
      this.kafkaRequirement.ingress_bytes * (rf + ts + (ib / tunables.iceberg_compression_ratio) - 1);
  }

  egressBytesKafka() { return this.kafkaRequirement.egress_bytes; }
}

class ClusterRequirement {
  constructor(workloads, tunables = new Tunables()) {
    this.workloads = workloads;
    this.tunables  = tunables;
    Assert.instanceOf('workloads', workloads, Array);
    Assert.instanceOf('tunables' , tunables , Tunables);
    Assert.true(workloads.length > 0);
    for (let i = 0; i < workloads.length; i++) {
      Assert.notNull(`workloads[${i}]`, workloads[i]);
      Assert.instanceOf(`workloads[${i}]`, workloads[i], Workload);
    }
  }

  _sum(fn) { return this.workloads.map(fn).reduce((acc, val) => acc + val, 0); }

  riops4()                         { return this._sum(w => w.riops4(this.tunables)); }
  wiops4()                         { return this._sum(w => w.wiops4(this.tunables)); }
  cpu()                            { return this._sum(w => w.cpu(this.tunables)); }
  ingressBytesWithReplication()    { return this._sum(w => w.ingressBytesWithReplication()); }
  ingressBytesWithoutReplication() { return this._sum(w => w.ingressBytesWithoutReplication()); }
  egressBytes()                    { return this._sum(w => w.egressBytes(this.tunables)); }
  egressBytesKafka()               { return this._sum(w => w.egressBytesKafka(this.tunables)); }
  partitions()                     { return this._sum(w => w.partitions()); }
  partitionReplicas()              { return this._sum(w => w.partitionReplicas()); }

  calculateRequiredComputeUnits(computeUnit) {
    Assert.instanceOf('computeUnit', computeUnit, AbstractComputeUnit);
    return Math.max(...Object.values(this.calculateRequiredComputeUnitsBreakdown(computeUnit)));
  }

  /** Added for the skill: per-constraint RPU so the binding constraint is visible. */
  calculateRequiredComputeUnitsBreakdown(computeUnit) {
    return {
      cpu:        this.calculateRequiredComputeUnitsCpu(computeUnit),
      read_iops:  this.calculateRequiredComputeUnitsRiops(computeUnit),
      write_iops: this.calculateRequiredComputeUnitsWiops(computeUnit),
      network_in: this.calculateRequiredComputeUnitsNetIn(computeUnit),
      network_out:this.calculateRequiredComputeUnitsNetOut(computeUnit),
      kafka_ingress: this.calculateRequiredComputeUnitsIngress(computeUnit),
      kafka_egress:  this.calculateRequiredComputeUnitsEgress(computeUnit),
      partitions: this.calculateRequiredComputeUnitsPartitions(computeUnit),
    };
  }

  calculateRequiredComputeUnitsCpu(computeUnit) {
    // An RPU is defined as 2 vCPUs and 8 GB of memory.
    const VCPU_PER_RPU = 2;
    const utilization = this.tunables.target_utilization_override_cpu;
    const performance = computeUnit.performance_score;
    const rawCpu      = this.cpu() / utilization / performance / VCPU_PER_RPU;
    const nominalCpu  = 2 * rawCpu;
    let adjFactor = Math.max(96 / 93, 124 / nominalCpu);
    if (nominalCpu < 93) adjFactor = Math.max(4 / 3, 18 / nominalCpu);
    if (nominalCpu < 9)  adjFactor = 2;
    return rawCpu * adjFactor;
  }

  calculateRequiredComputeUnitsRiops(computeUnit) {
    return this.riops4() / computeUnit.riops / this.tunables.target_utilization_override_iops;
  }

  calculateRequiredComputeUnitsWiops(computeUnit) {
    return this.wiops4() / computeUnit.wiops / this.tunables.target_utilization_override_iops;
  }

  calculateRequiredComputeUnitsNetIn(computeUnit) {
    const cu_network_bytes = computeUnit.network_gbps * 1e9 / 8;
    return this.ingressBytesWithReplication() / this.tunables.target_utilization_override_network / cu_network_bytes;
  }

  calculateRequiredComputeUnitsNetOut(computeUnit) {
    const cu_network_bytes = computeUnit.network_gbps * 1e9 / 8;
    return this.egressBytes() / this.tunables.target_utilization_override_network / cu_network_bytes;
  }

  calculateRequiredComputeUnitsIngress(computeUnit) {
    const cu_ingress_bytes = computeUnit.ingress_mbps * 1e6;
    return this.ingressBytesWithoutReplication() / this.tunables.target_utilization_override_kafka_in / cu_ingress_bytes;
  }

  calculateRequiredComputeUnitsEgress(computeUnit) {
    const cu_egress_bytes = computeUnit.egress_mbps * 1e6;
    return this.egressBytesKafka() / this.tunables.target_utilization_override_kafka_out / cu_egress_bytes;
  }

  calculateRequiredComputeUnitsPartitions(computeUnit) {
    return this.partitions() / computeUnit.partitions;
  }
}

class SupportedMachineType {
  constructor(name, computeUnit, numComputeUnits) {
    Assert.instanceOf('name', name, String);
    Assert.instanceOf('computeUnit', computeUnit, AbstractComputeUnit);
    Assert.instanceOf('numComputeUnits', numComputeUnits, Number);
    Assert.integer(numComputeUnits);
    this.name            = name;
    this.computeUnit     = computeUnit;
    this.numComputeUnits = numComputeUnits;
  }

  calculateInstanceCountNeeded(computeUnitsRequired, isMultiAZ) {
    return isMultiAZ
      ? 3 * Math.ceil(computeUnitsRequired / (this.numComputeUnits * 3))
      : Math.ceil(computeUnitsRequired / this.numComputeUnits);
  }

  calculateUtilization(computeUnitsRequired, isMultiAZ) {
    return computeUnitsRequired / this.calculateTotalComputeUnits(computeUnitsRequired, isMultiAZ);
  }

  calculateTotalComputeUnits(computeUnitsRequired, isMultiAZ) {
    return this.numComputeUnits * this.calculateInstanceCountNeeded(computeUnitsRequired, isMultiAZ);
  }
}

class HardwareConstrantOptimizer {
  constructor(maxBrokersSupported, supportedMachines) {
    this.maxBrokersSupported = maxBrokersSupported;
    this.supportedMachines   = supportedMachines;
  }

  calculateOptimalMachineType(computeUnitsRequired, computeUnit, isMultiAZ) {
    const MAX_BROKERS = this.maxBrokersSupported;

    function compare(prev, curr) {
      Assert.instanceOf('curr', curr, SupportedMachineType);
      if (prev === null && curr !== null) return curr;
      const prevUtilization = prev.calculateUtilization(computeUnitsRequired, isMultiAZ);
      const currUtilization = curr.calculateUtilization(computeUnitsRequired, isMultiAZ);
      return (currUtilization > prevUtilization) ? curr : prev;
    }

    function fitnessFunction(supportedMachine) {
      const x = supportedMachine.calculateInstanceCountNeeded(computeUnitsRequired, isMultiAZ);
      return (-Math.pow(x, 2) + MAX_BROKERS * x) / Math.pow(MAX_BROKERS / 2, 2);
    }

    return this.supportedMachines
      // must be a compatible machine (same cloud as target)
      .filter(machine => machine.computeUnit.constructor === computeUnit.constructor)
      // filter out candidates requiring more than the max broker count
      .filter(machine => machine.calculateInstanceCountNeeded(computeUnitsRequired, isMultiAZ) <= this.maxBrokersSupported)
      // heuristic to determine how we want to prioritize deployment
      .sort((a, b) => fitnessFunction(a) > fitnessFunction(b) ? -1 : 1)
      // get best utilization
      .reduce((prev, curr) => compare(prev, curr), null);
  }
}

/* ------------------------------------------------------------------ */
/* Model constants                                                     */
/* ------------------------------------------------------------------ */

const EST_MBPS_PER_PRODUCER     = 10;
const EST_MBPS_PER_CONSUMER     = 10;
const REPLICATION_FACTOR        = 3;
const LOCAL_RETENTION_TIME_MINS = 30;
const ESTIMATED_MSG_SIZE_BYTES  = 1000;
const MAX_BROKERS_SUPPORTED     = 24;

const AWS_CU   = new AmazonComputeUnit();
const GCP_CU   = new GoogleComputeUnit();
const AZURE_CU = new AzureComputeUnit();

const SUPPORTED_BROKER_INSTANCES = [
  // Amazon Instances
  new SupportedMachineType('m7gd.large'      , AWS_CU  , 1 ),
  new SupportedMachineType('m7gd.xlarge'     , AWS_CU  , 2 ),
  new SupportedMachineType('m7gd.2xlarge'    , AWS_CU  , 4 ),
  new SupportedMachineType('m7gd.4xlarge'    , AWS_CU  , 8 ),
  new SupportedMachineType('m7gd.8xlarge'    , AWS_CU  , 16),
  // new SupportedMachineType('m7gd.16xlarge', AWS_CU  , 32),
  // GCP Instances
  new SupportedMachineType('n2d-standard-2'  , GCP_CU  , 1 ),
  new SupportedMachineType('n2d-standard-4'  , GCP_CU  , 2 ),
  new SupportedMachineType('n2d-standard-16' , GCP_CU  , 8 ),
  new SupportedMachineType('n2d-standard-32' , GCP_CU  , 16),
  // Azure Instances
  new SupportedMachineType('Standard_D2d_v5' , AZURE_CU, 1 ),
  new SupportedMachineType('Standard_D4d_v5' , AZURE_CU, 2 ),
  new SupportedMachineType('Standard_D32d_v5', AZURE_CU, 16),
];

const GetComputeUnit = (cloudProvider) => {
  const c = String(cloudProvider).toUpperCase();
  if (c === 'AWS')   return AWS_CU;
  if (c === 'GCP')   return GCP_CU;
  if (c === 'AZURE') return AZURE_CU;
  throw new Error('Invalid cloudProvider. Must be one of: "AWS", "GCP", or "AZURE".');
};

/* ------------------------------------------------------------------ */
/* Spreadsheet-style entry points (programmatic use, parity tests)     */
/* ------------------------------------------------------------------ */

function buildWorkload(w) {
  const ingress = Number(w.ingress_mbps);
  const egress  = Number(w.egress_mbps);
  const producers = w.producers ? Number(w.producers) : Math.ceil(ingress / EST_MBPS_PER_PRODUCER);
  const consumers = w.consumers ? Number(w.consumers) : Math.ceil(egress  / EST_MBPS_PER_CONSUMER);
  const latency = w.batch_size_bytes
    ? new SizeBasedLatencyRequirement(Number(w.batch_size_bytes))
    : new TimeBasedLatencyRequirement(w.latency_ms != null ? Number(w.latency_ms) : 100);
  const kafka = new KafkaRequirement(
    ingress, egress, Number(w.partitions), producers, consumers,
    w.message_size_bytes != null ? Number(w.message_size_bytes) : ESTIMATED_MSG_SIZE_BYTES,
    w.replication_factor != null ? Number(w.replication_factor) : REPLICATION_FACTOR,
    LOCAL_RETENTION_TIME_MINS);
  const storage = new StorageRequirement(w.tiered_storage !== false);
  const iceberg = new IcebergRequirement(w.iceberg_fields != null ? Number(w.iceberg_fields) : -1);
  return { workload: new Workload(latency, kafka, storage, iceberg), producers, consumers };
}

function CALCULATE_RPU_SIMPLE(cloudProvider, enabled, numPartitions, ingressMBps, egressMBps,
                              latencyTargetMs, numProducers, numConsumers) {
  if (!enabled) return 0;
  if (cloudProvider == null) throw new Error('Cloud provider must be defined.');
  const { workload } = buildWorkload({
    ingress_mbps: ingressMBps, egress_mbps: egressMBps, partitions: numPartitions,
    latency_ms: latencyTargetMs, producers: numProducers, consumers: numConsumers,
  });
  return new ClusterRequirement([workload], new Tunables())
    .calculateRequiredComputeUnits(GetComputeUnit(cloudProvider));
}

function CALCULATE_RPU_SUPPORTED(cloudProvider, requiredComputeUnits, isMultiAZ) {
  if (cloudProvider == null) throw new Error('Cloud provider must be defined.');
  const optimizer = new HardwareConstrantOptimizer(MAX_BROKERS_SUPPORTED, SUPPORTED_BROKER_INSTANCES);
  const opt = optimizer.calculateOptimalMachineType(requiredComputeUnits, GetComputeUnit(cloudProvider), isMultiAZ);
  if (opt === null) throw new Error('No supported deployment available.');
  return opt.calculateTotalComputeUnits(requiredComputeUnits, isMultiAZ);
}

function CALCULATE_RPU_OPTIMAL_DEPLOYMENT(cloudProvider, requiredComputeUnits, isMultiAZ) {
  if (cloudProvider == null) throw new Error('Cloud provider must be defined.');
  const optimizer = new HardwareConstrantOptimizer(MAX_BROKERS_SUPPORTED, SUPPORTED_BROKER_INSTANCES);
  const opt = optimizer.calculateOptimalMachineType(requiredComputeUnits, GetComputeUnit(cloudProvider), isMultiAZ);
  if (opt === null) throw new Error('No supported deployment available.');
  return `${opt.calculateInstanceCountNeeded(requiredComputeUnits, isMultiAZ)}x ${opt.name}`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

function sizeCluster(cloud, workloadSpecs, isMultiAZ) {
  const cu = GetComputeUnit(cloud);
  const built = workloadSpecs.map(buildWorkload);
  const cluster = new ClusterRequirement(built.map(b => b.workload), new Tunables());
  const breakdown = cluster.calculateRequiredComputeUnitsBreakdown(cu);
  const required = Math.max(...Object.values(breakdown));
  const binding = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0][0];

  const optimizer = new HardwareConstrantOptimizer(MAX_BROKERS_SUPPORTED, SUPPORTED_BROKER_INSTANCES);
  const opt = optimizer.calculateOptimalMachineType(required, cu, isMultiAZ);

  const result = {
    cloud: cu.name,
    multi_az: isMultiAZ,
    required_rpu: round(required),
    binding_constraint: binding,
    rpu_by_constraint: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, round(v)])),
    totals: {
      ingress_mbps: round(cluster.ingressBytesWithoutReplication() / 1e6, 2),
      egress_mbps: round(cluster.egressBytesKafka() / 1e6, 2),
      partitions: cluster.partitions(),
      partition_replicas: cluster.partitionReplicas(),
      producers: built.reduce((a, b) => a + b.producers, 0),
      consumers: built.reduce((a, b) => a + b.consumers, 0),
    },
  };

  if (opt === null) {
    result.supported_rpu = null;
    result.deployment = null;
    result.error = `No supported deployment within ${MAX_BROKERS_SUPPORTED} brokers.`;
  } else {
    const count = opt.calculateInstanceCountNeeded(required, isMultiAZ);
    result.supported_rpu = opt.calculateTotalComputeUnits(required, isMultiAZ);
    result.deployment = `${count}x ${opt.name}`;
    result.broker_count = count;
    result.instance_type = opt.name;
    result.rpu_per_broker = opt.numComputeUnits;
    result.utilization_pct = round(100 * opt.calculateUtilization(required, isMultiAZ), 1);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Timeline (projected workload over time)                             */
/* ------------------------------------------------------------------ */

const isYearMonth = s => /^\d{4}-\d{2}$/.test(String(s));

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Hours in a period label: YYYY-MM, YYYY-Qn, or YYYY. Anything else = 730 (avg month). */
function hoursInPeriod(label) {
  const s = String(label);
  const daysBetween = (a, b) => (b - a) / 86400000;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) {
    return new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() * 24;
  }
  if ((m = s.match(/^(\d{4})-?Q([1-4])$/i))) {
    const y = +m[1], q = +m[2];
    return daysBetween(Date.UTC(y, (q - 1) * 3, 1), Date.UTC(y, q * 3, 1)) * 24;
  }
  if ((m = s.match(/^(\d{4})$/))) {
    return daysBetween(Date.UTC(+m[1], 0, 1), Date.UTC(+m[1] + 1, 0, 1)) * 24;
  }
  return 730;
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Expand a growth spec into explicit periods.
 * growth: { months, monthly_pct | annual_pct, partition_pct?, start? }
 * Throughput (and explicit producer/consumer counts) compound by the growth
 * rate; partitions compound by partition_pct (defaults to the throughput rate).
 */
function expandGrowth(baseWorkloads, growth) {
  const months = Number(growth.months || 12);
  let rate;
  if (growth.monthly_pct != null) rate = Number(growth.monthly_pct) / 100;
  else if (growth.annual_pct != null) rate = Math.pow(1 + Number(growth.annual_pct) / 100, 1 / 12) - 1;
  else throw new Error('growth needs monthly_pct or annual_pct');
  let pRate;
  if (growth.partition_monthly_pct != null) pRate = Number(growth.partition_monthly_pct) / 100;
  else if (growth.partition_annual_pct != null) pRate = Math.pow(1 + Number(growth.partition_annual_pct) / 100, 1 / 12) - 1;
  else pRate = rate;
  const start = growth.start || currentYearMonth();

  const periods = [];
  for (let i = 0; i < months; i++) {
    const f = Math.pow(1 + rate, i);
    const pf = Math.pow(1 + pRate, i);
    periods.push({
      label: isYearMonth(start) ? addMonths(start, i) : `M${i}`,
      workloads: baseWorkloads.map(w => ({
        ...w,
        ingress_mbps: Number(w.ingress_mbps) * f,
        egress_mbps: Number(w.egress_mbps) * f,
        partitions: Math.ceil(Number(w.partitions) * pf),
        producers: w.producers ? Math.ceil(Number(w.producers) * f) : undefined,
        consumers: w.consumers ? Math.ceil(Number(w.consumers) * f) : undefined,
      })),
    });
  }
  return periods;
}

function sizeTimeline(cloud, periods, isMultiAZ) {
  const rows = periods.map((p, i) => {
    const label = p.label || `M${i}`;
    try {
      const r = sizeCluster(cloud, p.workloads, isMultiAZ);
      return {
        period: label,
        ingress_mbps: r.totals.ingress_mbps,
        egress_mbps: r.totals.egress_mbps,
        partitions: r.totals.partitions,
        required_rpu: r.required_rpu,
        supported_rpu: r.supported_rpu,
        deployment: r.deployment,
        utilization_pct: r.utilization_pct ?? null,
        binding_constraint: r.binding_constraint,
        rpu_hours: r.supported_rpu != null
          ? r.supported_rpu * (p.hours != null ? Number(p.hours) : hoursInPeriod(label))
          : null,
        ...(r.error ? { error: r.error } : {}),
      };
    } catch (e) {
      return { period: label, error: e.message };
    }
  });

  const ok = rows.filter(r => r.supported_rpu != null);
  const scaling_events = [];
  for (let i = 1; i < rows.length; i++) {
    // Only count changes between two deployable periods; the first undeployable
    // period is reported in summary.first_unsupported_period instead.
    if (rows[i].supported_rpu == null || rows[i - 1].supported_rpu == null) continue;
    if (rows[i].deployment !== rows[i - 1].deployment) {
      scaling_events.push({
        period: rows[i].period,
        from: rows[i - 1].deployment, to: rows[i].deployment,
        from_rpu: rows[i - 1].supported_rpu, to_rpu: rows[i].supported_rpu,
      });
    }
  }
  const firstOver = rows.find(r => r.error);
  const peak = ok.reduce((a, b) => (b.supported_rpu > (a?.supported_rpu ?? -1) ? b : a), null);

  return {
    cloud: GetComputeUnit(cloud).name,
    multi_az: isMultiAZ,
    periods: rows,
    summary: {
      start_rpu: rows[0]?.supported_rpu ?? null,
      end_rpu: rows[rows.length - 1]?.supported_rpu ?? null,
      peak_rpu: peak?.supported_rpu ?? null,
      peak_period: peak?.period ?? null,
      total_rpu_hours: ok.reduce((a, r) => a + r.rpu_hours, 0),
      scaling_event_count: scaling_events.length,
      first_unsupported_period: firstOver ? firstOver.period : null,
      first_unsupported_reason: firstOver ? firstOver.error : null,
    },
    scaling_events,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { args[key] = true; }
    else { args[key] = next; i++; }
  }
  return args;
}

const toBool = (v, dflt) => {
  if (v === undefined) return dflt;
  if (typeof v === 'boolean') return v;
  return !['false', '0', 'no', 'n', 'single'].includes(String(v).toLowerCase());
};

/** Strict AZ parser: multi-AZ -> true, single-AZ -> false; anything else is an error. */
function parseAz(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['true', 'multi', 'multi-az', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'single', 'single-az', 'no', 'n', '0'].includes(s)) return false;
  throw new Error(`invalid availability zones value "${v}": use single or multi (or true/false for multi-AZ)`);
}

const USAGE = `Redpanda workload sizing

Required (no defaults):
  --cloud AWS|GCP|AZURE|all     cloud provider; "all" compares the three
  --az single|multi             availability zones (or --multi-az true|false)
  --partitions <n>              partition count (not replicas)
  --ingress <MB/s>              producer throughput, before replication
  --egress <MB/s>               consumer throughput, all consumer groups

Point in time:
  node sizing.js --cloud AWS --az multi --partitions 1000 --ingress 50 --egress 150

Projection over time:
  node sizing.js --cloud AWS --az multi --partitions 1000 --ingress 50 --egress 150 \\
                 --months 12 --monthly-growth 8
  node sizing.js --input plan.json          (examples in ../resources/; the file must set
                                             "cloud" and "multi_az")

Optional:
  --latency <ms>                default 100
  --producers <n>               default ceil(ingress / 10)
  --consumers <n>               default ceil(egress / 10)
  --message-size <bytes>        default 1000
  --rf <n>                      replication factor, odd, default 3
  --tiered-storage true|false   default true
  --iceberg-fields <n>          enable Iceberg with n schema fields
  --months <n>                  projection length, default 12
  --monthly-growth <pct>        or --annual-growth <pct>
  --partition-monthly-growth <pct> | --partition-annual-growth <pct>
                                default: same as throughput growth
  --start YYYY-MM               default current month
  --format csv                  timeline output as CSV
  --model                       print the sizing model constants
  --help                        this text
`;

function describeModel() {
  const t = new Tunables();
  return {
    rpu_definition: { vcpu: 2, memory_gb: 8 },
    max_brokers_per_cluster: MAX_BROKERS_SUPPORTED,
    max_partitions_per_cluster: 112500,
    multi_az_broker_multiple: 3,
    target_utilization: {
      cpu: t.target_utilization_override_cpu,
      iops: t.target_utilization_override_iops,
      network: t.target_utilization_override_network,
      kafka_in: t.target_utilization_override_kafka_in,
      kafka_out: t.target_utilization_override_kafka_out,
    },
    compute_units: [AWS_CU, GCP_CU, AZURE_CU].map(cu => ({
      cloud: cu.name,
      kafka_ingress_mbps_per_rpu: cu.ingress_mbps,
      kafka_egress_mbps_per_rpu: cu.egress_mbps,
      network_gbps_per_rpu: cu.network_gbps,
      read_iops_per_rpu: cu.riops,
      write_iops_per_rpu: cu.wiops,
      partitions_per_rpu: cu.partitions,
      cpu_performance_score: cu.performance_score,
    })),
    instance_catalog: SUPPORTED_BROKER_INSTANCES.map(m => ({
      cloud: m.computeUnit.name, instance_type: m.name, rpu_per_broker: m.numComputeUnits,
    })),
    input_defaults: {
      latency_ms: 100,
      message_size_bytes: ESTIMATED_MSG_SIZE_BYTES,
      replication_factor: REPLICATION_FACTOR,
      mbps_per_producer: EST_MBPS_PER_PRODUCER,
      mbps_per_consumer: EST_MBPS_PER_CONSUMER,
      tiered_storage: true,
      multi_az: true,
      max_batch_size_bytes: t.batch_size_bytes,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.model) {
    process.stdout.write(JSON.stringify(describeModel(), null, 2) + '\n');
    return;
  }
  if (args.help || args.h || process.argv.length <= 2) {
    process.stdout.write(USAGE);
    return;
  }

  // Cloud provider and AZ mode are required: there is no safe default, and
  // either one can change the answer substantially.
  const given = v => v !== undefined && v !== null && v !== true && v !== '';
  let cloud = args.cloud;
  let azRaw = given(args['multi-az']) ? args['multi-az']
            : given(args.az) ? (String(args.az).toLowerCase() === 'multi' ? 'true' : String(args.az)) : undefined;
  let workloads;
  let periods = null;
  let growth = null;

  if (args.input) {
    const spec = JSON.parse(require('fs').readFileSync(args.input, 'utf8'));
    if (given(spec.cloud)) cloud = spec.cloud;
    // In a file, a JSON boolean is a real value (on the command line a bare
    // flag also parses as `true`, which is why given() rejects it).
    if (typeof spec.multi_az === 'boolean' || given(spec.multi_az)) azRaw = spec.multi_az;
    const missing = [];
    if (!given(cloud)) missing.push('cloud provider ("cloud": "AWS" | "GCP" | "AZURE" | "all")');
    if (typeof azRaw !== 'boolean' && !given(azRaw)) missing.push('availability zones ("multi_az": true for multi-AZ, false for single-AZ)');
    if (missing.length) throw new Error(`missing required input: ${missing.join('; ')}`);
    workloads = spec.workloads;
    periods = spec.periods || null;
    growth = spec.growth || null;
  } else {
    const missing = [];
    if (!given(cloud)) missing.push('cloud provider (--cloud AWS|GCP|AZURE|all)');
    if (!given(azRaw)) missing.push('availability zones (--az single|multi, or --multi-az true|false)');
    if (!given(args.partitions)) missing.push('partition count (--partitions)');
    if (!given(args.ingress)) missing.push('ingress MB/s (--ingress)');
    if (!given(args.egress)) missing.push('egress MB/s (--egress)');
    if (missing.length) throw new Error(`missing required input: ${missing.join('; ')}`);
  }
  if (String(cloud).toUpperCase() !== 'ALL') GetComputeUnit(cloud); // reject unknown clouds early
  const isMultiAZ = parseAz(azRaw);

  if (!args.input) {
    workloads = [{
      ingress_mbps: args.ingress,
      egress_mbps: args.egress,
      partitions: args.partitions,
      latency_ms: args.latency,
      producers: args.producers,
      consumers: args.consumers,
      message_size_bytes: args['message-size'],
      replication_factor: args.rf,
      tiered_storage: args['tiered-storage'] === undefined ? true : toBool(args['tiered-storage'], true),
      iceberg_fields: args['iceberg-fields'],
    }];
    if (args['monthly-growth'] !== undefined || args['annual-growth'] !== undefined || args.months !== undefined) {
      growth = {
        months: args.months,
        monthly_pct: args['monthly-growth'],
        annual_pct: args['annual-growth'],
        partition_monthly_pct: args['partition-monthly-growth'],
        partition_annual_pct: args['partition-annual-growth'],
        start: args.start,
      };
      if (growth.monthly_pct === undefined && growth.annual_pct === undefined) growth.monthly_pct = 0;
    }
  }

  const validate = (ws, where) => {
    if (!Array.isArray(ws) || ws.length === 0) throw new Error(`${where}: no workloads given`);
    for (const [i, w] of ws.entries()) {
      for (const f of ['ingress_mbps', 'egress_mbps', 'partitions']) {
        if (w[f] === undefined || w[f] === null || w[f] === true) {
          throw new Error(`${where} workload[${i}] missing required field: ${f}`);
        }
      }
    }
  };

  if (growth && !periods) {
    validate(workloads, 'base');
    periods = expandGrowth(workloads, growth);
  }

  const clouds = String(cloud).toUpperCase() === 'ALL' ? ['AWS', 'GCP', 'AZURE'] : [cloud];

  if (periods) {
    periods.forEach((p, i) => validate(p.workloads, `periods[${i}]`));
    const results = clouds.map(c => sizeTimeline(c, periods, isMultiAZ));
    if (String(args.format).toLowerCase() === 'csv') {
      const cols = ['cloud', 'period', 'ingress_mbps', 'egress_mbps', 'partitions', 'required_rpu',
                    'supported_rpu', 'deployment', 'utilization_pct', 'binding_constraint', 'rpu_hours', 'error'];
      const lines = [cols.join(',')];
      for (const r of results) for (const p of r.periods) {
        lines.push(cols.map(c => {
          const v = c === 'cloud' ? r.cloud : p[c];
          return v == null ? '' : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
        }).join(','));
      }
      process.stdout.write(lines.join('\n') + '\n');
    } else {
      process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n');
    }
    return;
  }

  validate(workloads, 'input');
  const results = clouds.map(c => sizeCluster(c, workloads, isMultiAZ));
  process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n');
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message }, null, 2) + '\n');
    process.exit(1);
  }
}

module.exports = {
  CALCULATE_RPU_SIMPLE, CALCULATE_RPU_SUPPORTED, CALCULATE_RPU_OPTIMAL_DEPLOYMENT,
  sizeCluster, sizeTimeline, expandGrowth, describeModel, hoursInPeriod,
};
