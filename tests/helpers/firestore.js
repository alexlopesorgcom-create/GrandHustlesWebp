'use strict';
module.exports = function fakeDb(initial) {
  const data = new Map(Object.entries(initial)); let queue = Promise.resolve();
  const ref = path => ({ path, id: path.split('/').pop() });
  const snap = r => ({ ...r, ref: r, exists: data.has(r.path), data: () => structuredClone(data.get(r.path)) });
  const db = {
    collection(name) {
      const filters = []; let maximum = Infinity; let order;
      const query = { doc: id => ref(name + '/' + id),
        where(k, op, value) { filters.push([k, op, value]); return query; },
        limit(n) { maximum = n; return query; }, orderBy(k) { order = k; return query; },
        async get() {
          let entries = [...data.entries()].filter(([p,v]) => p.startsWith(name + '/') && filters.every(([k,op,x]) =>
            op === '==' ? v[k] === x : op === '>' ? v[k] > x : v[k] <= x));
          if (order) entries.sort((a,b) => a[1][order] - b[1][order]);
          return { docs: entries.slice(0,maximum).map(([p]) => snap(ref(p))) };
        }
      }; return query;
    },
    runTransaction(callback) {
      const run = queue.then(async () => {
        const writes = []; let wrote = false;
        const tx = { async get(r) { if(wrote) throw Error('Read after write'); return snap(r); },
          update(r,v) { wrote = true; if(!data.has(r.path)) throw Error('Missing'); writes.push(() => data.set(r.path,{...data.get(r.path),...v})); },
          set(r,v) { wrote = true; writes.push(() => data.set(r.path,v)); }
        };
        const result = await callback(tx); writes.forEach(w => w()); return result;
      }); queue = run.catch(() => {}); return run;
    }
  }; return { db, data };
};
