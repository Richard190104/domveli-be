import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Publikuje config.json a obrázky do GitHub repa Richard190104/domveli-be.
// GitHub token ostáva len v Supabase secrets, prehliadač ho nikdy nevidí.
const REPO = 'Richard190104/domveli-be';
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://richard190104.github.io',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const IMAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}\.(?:webp|png|jpe?g|gif|avif)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 30;

function validateConfig(value: any) {
  const home = value?.DOMVELI_CONFIG;
  if (!home || !Array.isArray(home.categories) || !Array.isArray(home.banners) || !home.categorySection ||
      !home.story || !home.inspirationBlog || !Array.isArray(value.notificationsConfig) ||
      !Array.isArray(value.navbannerConfig)) {
    throw new HttpError(400, 'Neplatná štruktúra configu.');
  }
}

function referencedImages(value: unknown): Set<string> {
  const names = new Set<string>();
  const visit = (item: unknown, key = '') => {
    if (typeof item === 'string' && (key === 'image' || key === 'images')) {
      const match = /^images\/([a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:webp|png|jpe?g|gif|avif))$/i.exec(item);
      if (match) names.add(match[1]);
    } else if (Array.isArray(item)) item.forEach((child) => visit(child, key));
    else if (item && typeof item === 'object') Object.entries(item).forEach(([k, v]) => visit(v, k));
  };
  visit(value);
  return names;
}

// Kontrola podpisu súboru, aby sa cez obrázky nedal nahrať iný obsah.
function looksLikeImage(base64: string): boolean {
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64.slice(0, 48)), (c) => c.charCodeAt(0)); } catch { return false; }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  return (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') ||
    ascii(1, 4) === 'PNG' || (bytes[0] === 0xff && bytes[1] === 0xd8) ||
    ascii(0, 3) === 'GIF' || ascii(4, 12) === 'ftypavif';
}

async function github(path: string, method = 'GET', body?: unknown) {
  const token = Deno.env.get('DOMVELI_GITHUB_TOKEN');
  if (!token) throw new HttpError(500, 'Chýba secret DOMVELI_GITHUB_TOKEN.');
  const response = await fetch(`https://api.github.com/repos/${REPO}${path ? '/' + path : ''}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'domveli-publish',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
  if (!response.ok) throw new HttpError(502, `GitHub HTTP ${response.status}: ${data.message ?? 'chyba'}`);
  return data;
}

async function publish(payload: any) {
  const config = payload?.config;
  validateConfig(config);
  const images: Record<string, string> = payload?.images && typeof payload.images === 'object' ? payload.images : {};
  const entries = Object.entries(images);
  if (entries.length > MAX_IMAGES) throw new HttpError(400, 'Príliš veľa nových obrázkov naraz.');
  for (const [name, data] of entries) {
    if (!IMAGE_NAME.test(name)) throw new HttpError(400, `Neplatný názov obrázka: ${name}`);
    if (typeof data !== 'string' || data.length * 0.75 > MAX_IMAGE_BYTES) throw new HttpError(400, `Obrázok ${name} je príliš veľký.`);
    if (!looksLikeImage(data)) throw new HttpError(400, `Súbor ${name} nie je platný obrázok.`);
  }
  const used = referencedImages(config);
  const json = JSON.stringify(config, null, 2) + '\n';

  const repo = await github('');
  const branch = repo.default_branch as string;
  const ref = await github(`git/ref/heads/${encodeURIComponent(branch)}`);
  const commit = await github(`git/commits/${ref.object.sha}`);
  const oldTree = await github(`git/trees/${commit.tree.sha}?recursive=1`);
  if (oldTree.truncated) throw new HttpError(502, 'Repozitár je príliš veľký na bezpečné publikovanie.');
  const existing = new Set<string>(oldTree.tree.filter((e: any) => e.type === 'blob').map((e: any) => e.path));

  let oldConfig: unknown = {};
  const oldConfigEntry = oldTree.tree.find((e: any) => e.path === 'config.json');
  if (oldConfigEntry) {
    const blob = await github(`git/blobs/${oldConfigEntry.sha}`);
    oldConfig = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))));
  }

  const tree: any[] = [{ path: 'config.json', mode: '100644', type: 'blob', content: json }];
  for (const name of used) {
    if (images[name]) {
      const blob = await github('git/blobs', 'POST', { content: images[name], encoding: 'base64' });
      tree.push({ path: `images/${name}`, mode: '100644', type: 'blob', sha: blob.sha });
    } else if (!existing.has(`images/${name}`)) {
      throw new HttpError(400, `Chýba obrázok images/${name}.`);
    }
  }
  // Obrázky, ktoré config už nepoužíva, sa zmažú.
  for (const name of referencedImages(oldConfig)) {
    if (!used.has(name) && existing.has(`images/${name}`)) tree.push({ path: `images/${name}`, mode: '100644', type: 'blob', sha: null });
  }

  const nextTree = await github('git/trees', 'POST', { base_tree: commit.tree.sha, tree });
  const nextCommit = await github('git/commits', 'POST', {
    message: 'Aktualizácia DOMVELI konfigurácie a obrázkov (editor)',
    tree: nextTree.sha,
    parents: [ref.object.sha],
  });
  await github(`git/refs/heads/${encodeURIComponent(branch)}`, 'PATCH', { sha: nextCommit.sha, force: false });
  return { sha: nextCommit.sha as string };
}

async function deployment(payload: any) {
  const sha = payload?.sha;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new HttpError(400, 'Neplatný commit.');
  const result = await github(`actions/runs?head_sha=${sha}&per_page=100`);
  const runs = (result.workflow_runs ?? []).filter((run: any) => run.head_sha === sha &&
    (/pages|deploy/i.test(run.name ?? '') || /pages-build-deployment|deploy/i.test(run.path ?? '')));
  const run = runs.sort((a: any, b: any) => b.id - a.id)[0];
  if (!run) return { status: 'waiting' };
  return { status: run.status, conclusion: run.conclusion, url: run.html_url };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Only POST is supported.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const allowedUser = (Deno.env.get('DOMVELI_ALLOWED_USER_ID') || Deno.env.get('PLANBOARD_OWNER_ID') || '').trim();
    if (!url || !serviceRole || !allowedUser) throw new HttpError(500, 'Function is not configured.');

    const jwt = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) throw new HttpError(401, 'Unauthorized.');
    const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data.user) throw new HttpError(401, 'Unauthorized.');
    if (data.user.id !== allowedUser) throw new HttpError(403, 'Forbidden.');

    const payload = await request.json();
    if (payload?.action === 'publish') return json(await publish(payload));
    if (payload?.action === 'deployment') return json(await deployment(payload));
    throw new HttpError(400, 'Neznáma akcia.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : 'Chyba servera.' }, 500);
  }
});
