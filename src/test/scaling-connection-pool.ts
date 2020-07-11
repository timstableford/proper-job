import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';

import { ConnectionPoolRunner, ScalingConnectionPool } from '../';

describe('Scaling Connection Pool Tests', () => {
  let created = 0;
  let destroyed = 0;

  class Runner implements ConnectionPoolRunner {
    public constructor() {
      created = created + 1;
    }
    public quit(): Promise<void> {
      destroyed = destroyed + 1;
      return Promise.resolve();
    }
  }
  let pool: ScalingConnectionPool<Runner>;

  beforeEach(() => {
    created = 0;
    destroyed = 0;
    pool = new ScalingConnectionPool(() => new Runner(), {
      minInstances: 1,
      maxInstances: 4,
      scaleInterval: 10,
      scaleDownAt: 0.4,
      scaleUpAt: 0.8,
    });
  });

  afterEach(async () => {
    await pool.quit();
    expect(pool.getInstanceCount(), 'Instance count 0 after shutdown').to.equal(0);
  });

  it('Simple usage', async () => {
    const res = await pool.run(instance => {
      expect(instance).to.be.an('object');
      return Promise.resolve('bob');
    });
    expect(res).to.equal('bob');
  });

  it('Scale to minimum on creation', async () => {
    while (pool.getInstanceCount() < 1) {
      await new Promise(resolve => pool.once('scale', resolve));
    }

    expect(pool.getInstanceCount(), 'Instance count 1 after warmup').to.equal(1);
    expect(pool.getClaimedCount(), '0 claimed after warmup').to.equal(0);

    const usage = await new Promise(resolve => pool.once('usage', resolve));
    expect(usage).to.equal(0);
    expect(pool.getInstanceCount(), 'Shouldnt have scaled up with no usage').to.equal(1);
  });

  it('Scales up when loaded', async () => {
    // Wait a couple of usage cycles to make sure it scales to 1 and not more
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => pool.once('usage', resolve));
    }
    expect(pool.getInstanceCount(), 'Instance count 1 after warmup').to.equal(1);

    // Now to load it. Which basically means just claiming an instance for a while.
    const claimedInstance1 = await pool.claim();

    // Wait a couple more cycles to make sure it only scales up by 1.
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => pool.once('usage', resolve));
    }
    expect(pool.getInstanceCount(), 'Instance 2 instances aftert a few scale cycles').to.equal(2);

    pool.release(claimedInstance1);
  });

  it('Scales down when load reduced', async () => {
    // Claim 4
    const claimed: Runner[] = [];
    for (let i = 0; i < 4; i++) {
      claimed.push(await pool.claim());
    }

    expect(pool.getInstanceCount(), 'Instance count 4 after all claimed').to.equal(4);
    expect(pool.getClaimedCount(), '4 claimed after 4 claims').to.equal(4);
    expect(created).to.equal(4);
    expect(destroyed).to.equal(0);

    for (const instance of claimed) {
      pool.release(instance);
    }

    while (pool.getInstanceCount() > 1) {
      await new Promise(resolve => pool.once('scale', resolve));
    }

    // Wait a few more ticks to be sure it doesnt keep going
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => pool.once('usage', resolve));
    }
    expect(pool.getInstanceCount(), 'Instance count 1 after scale down').to.equal(1);
    expect(pool.getClaimedCount(), '0 claimed after all released').to.equal(0);
    expect(created).to.equal(4);
    expect(destroyed).to.equal(3);
  });

  it('Instantly scales', async () => {
    let usageCalled = false;
    pool.once('usage', () => (usageCalled = true));

    const start = Date.now();
    const claimed: Runner[] = [];
    for (let i = 0; i < 4; i++) {
      claimed.push(await pool.claim());
    }
    expect(Date.now() - start).to.be.below(10);
    expect(usageCalled).to.equal(false);

    for (const instance of claimed) {
      pool.release(instance);
    }
  });
});
