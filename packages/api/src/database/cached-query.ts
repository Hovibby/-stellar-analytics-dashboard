import { db } from './connection';

export interface CacheOptions {
  ttlSeconds: number;
  refreshThreshold?: number;
  tags?: string[];
  version?: string;
}

export interface CacheResult<T> {
  data: T;
  hit: boolean;
  source: 'cache' | 'fetcher';
}

export async function cachedQuery<T>(
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await db.cacheGet<T>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const result = await fetcher();
  await db.cacheSet(cacheKey, result, ttlSeconds);
  return result;
}

export async function cachedQueryWithRefresh<T>(
  cacheKey: string,
  options: CacheOptions,
  fetcher: () => Promise<T>
): Promise<CacheResult<T>> {
  try {
    const cached = await db.cacheGet<T>(cacheKey);
    
    if (cached !== null) {
      const currentTTL = await db.cacheGetTTL(cacheKey);
      const refreshThreshold = options.refreshThreshold ?? options.ttlSeconds * 0.2;
      
      if (currentTTL <= refreshThreshold) {
        refreshCacheAsync(cacheKey, options.ttlSeconds, fetcher);
      }
      
      await db.incrementCacheMetric('hits');
      return { data: cached, hit: true, source: 'cache' };
    }

    await db.incrementCacheMetric('misses');
    const result = await fetcher();
    await db.cacheSet(cacheKey, result, options.ttlSeconds);
    
    if (options.tags) {
      await addTagsToKey(cacheKey, options.tags);
    }
    
    return { data: result, hit: false, source: 'fetcher' };
  } catch (error) {
    await db.incrementCacheMetric('errors');
    const result = await fetcher();
    return { data: result, hit: false, source: 'fetcher' };
  }
}

async function refreshCacheAsync<T>(
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<void> {
  try {
    const result = await fetcher();
    await db.cacheSet(cacheKey, result, ttlSeconds);
  } catch (error) {
    console.error(`Failed to refresh cache for key ${cacheKey}:`, error);
  }
}

export async function invalidateCacheByKey(key: string): Promise<void> {
  await db.cacheDel(key);
  await db.incrementCacheMetric('invalidations');
}

export async function invalidateCacheByPattern(pattern: string): Promise<number> {
  const count = await db.cacheDelPattern(pattern);
  await db.incrementCacheMetric('pattern_invalidations');
  return count;
}

export async function invalidateCacheByTag(tag: string): Promise<number> {
  const pattern = `tag:${tag}:*`;
  const keys = await db.getRedis().keys(pattern);
  
  if (keys.length === 0) {
    return 0;
  }
  
  const cacheKeys = await Promise.all(
    keys.map(async (tagKey: string) => {
      const cacheKey = await db.getRedis().get(tagKey);
      return cacheKey;
    })
  );
  
  const validCacheKeys = cacheKeys.filter((k: string | null): k is string => k !== null);
  
  if (validCacheKeys.length > 0) {
    await db.cacheDelPattern(validCacheKeys.join('|').replace(/\*/g, '*'));
  }
  
  await db.cacheDelPattern(pattern);
  await db.incrementCacheMetric('tag_invalidations');
  return validCacheKeys.length;
}

async function addTagsToKey(cacheKey: string, tags: string[]): Promise<void> {
  const redis = db.getRedis();
  await Promise.all(
    tags.map(async (tag) => {
      const tagKey = `tag:${tag}:${cacheKey}`;
      await redis.set(tagKey, cacheKey);
      await redis.expire(tagKey, 86400 * 30);
    })
  );
}

export function buildCacheKey(prefix: string, parts: Record<string, unknown>): string {
  const serialized = Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(':');

  return `${prefix}:${serialized}`;
}

export function buildVersionedCacheKey(
  prefix: string,
  version: string,
  parts: Record<string, unknown>
): string {
  const baseKey = buildCacheKey(prefix, parts);
  return `${baseKey}:v${version}`;
}
