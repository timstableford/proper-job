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

  beforeEach(() => {
    created = 0;
    destroyed = 0;
  });

  it('Error creating runner handled', async () => {
    const testPool = new ScalingConnectionPool(
      () => {
        throw new Error('Test Error');
      },
      {
        minInstances: 1,
        maxInstances: 4,
        scaleInterval: 10,
        scaleDownAt: 0.4,
        scaleUpAt: 0.8,
      },
    );

    const err: Error = await new Promise(resolve => testPool.once('error', resolve));
    expect(err.message).to.equal('Test Error');
    expect(testPool.getInstanceCount()).to.equal(0);

    await testPool.quit();
  });

  describe('Auto-scaling tests', () => {
    let pool: ScalingConnectionPool<Runner>;

    beforeEach(() => {
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

    it('Run error passthrough and release', async () => {
      expect(pool.getClaimedCount()).to.equal(0);
      try {
        await pool.run(() => {
          throw new Error('Test Error');
        });
      } catch (err) {
        expect(err.message).to.equal('Test Error');
      }
      expect(pool.getClaimedCount()).to.equal(0);
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

    it('Fired initial available', async () => {
      // This fires or the test times out
      await new Promise(resolve => pool.once('available', resolve));
      expect(pool.getInstanceCount(), 'Instance count 1 after warmup').to.equal(1);
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

  describe('Manual-scaling tests', () => {
    let pool: ScalingConnectionPool<Runner>;

    beforeEach(() => {
      pool = new ScalingConnectionPool(() => new Runner(), {
        minInstances: 2,
        maxInstances: 4,
        autoScale: false,
        responsiveScale: false,
      });
    });

    afterEach(async () => {
      await pool.quit();
      expect(pool.getInstanceCount(), 'Instance count 0 after shutdown').to.equal(0);
    });

    it('Still auto-scales to minimum', async () => {
      while (pool.getInstanceCount() < 2) {
        await new Promise(resolve => pool.once('scale', resolve));
      }
      expect(pool.getInstanceCount()).to.equal(2);
    });

    it('Cannot scale below minimum instance', async () => {
      while (pool.getInstanceCount() < 2) {
        await new Promise(resolve => pool.once('scale', resolve));
      }
      expect(pool.getInstanceCount()).to.equal(2);

      await pool.scaleDown();
      await pool.scaleDown();

      expect(pool.getInstanceCount()).to.equal(2);
    });

    it('Scale up and stay there', async () => {
      while (pool.getInstanceCount() < 2) {
        await new Promise(resolve => pool.once('scale', resolve));
      }

      await pool.scaleUp();

      expect(pool.getInstanceCount()).to.equal(3);
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(pool.getInstanceCount()).to.equal(3);
    });

    it('Scale up and down', async () => {
      while (pool.getInstanceCount() < 2) {
        await new Promise(resolve => pool.once('scale', resolve));
      }

      await pool.scaleUp();
      expect(pool.getInstanceCount()).to.equal(3);

      await pool.scaleDown();
      expect(pool.getInstanceCount()).to.equal(2);
    });

    it('Claim waits for scale up', async () => {
      while (pool.getInstanceCount() < 2) {
        await new Promise(resolve => pool.once('scale', resolve));
      }

      const initialClaims = [await pool.claim(), await pool.claim()];
      expect(pool.getClaimedCount()).to.equal(2);

      let thirdClaimed = false;
      const thirdClaimPromise = pool.claim().then(claim => {
        thirdClaimed = true;
        return claim;
      });

      expect(pool.getClaimedCount()).to.equal(2);
      expect(pool.getInstanceCount()).to.equal(2);

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(thirdClaimed).to.equal(false);

      await pool.scaleUp();
      expect(pool.getInstanceCount()).to.equal(3);
      const thirdClaim = await thirdClaimPromise;
      expect(thirdClaimed).to.equal(true);

      pool.release(initialClaims[0]);
      pool.release(initialClaims[1]);
      pool.release(thirdClaim);

      expect(pool.getClaimedCount()).to.equal(0);
    });
  });
});
