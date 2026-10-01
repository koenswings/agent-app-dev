/**
 * Structure checks for duration-tests App fixtures (idea#166).
 * No Pi / Engine / Docker required — asserts versioned trees have the
 * files Axle / Pixel walkers need to reference.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../duration-tests');
const FIX = join(ROOT, 'fixtures');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function mustExist(abs, label) {
  assert.ok(existsSync(abs), `missing ${label}: ${abs}`);
}

describe('duration-tests fixtures (idea#166)', () => {
  it('pack root docs exist', () => {
    mustExist(join(ROOT, 'README.md'), 'README');
    mustExist(join(ROOT, 'walker-ref.yaml'), 'walker-ref.yaml');
    mustExist(join(ROOT, 'scripts/post-dock-restore-running.sh'), 'post-dock restore script');
    mustExist(join(ROOT, 'LESSON_CHROME.md'), 'lesson chrome Pixel note');

  });


  it('empty disk pack is META-only (EmptyDiskPanel / no apps)', () => {
    const e = join(FIX, 'empty');
    mustExist(join(e, 'META.yaml'), 'empty META');
    mustExist(join(e, 'README.md'), 'empty README');

    const meta = readFileSync(join(e, 'META.yaml'), 'utf8');
    assert.match(meta, /diskId:\s*duration-empty-001/);

    // Engine isAppDisk = test -d apps — must not exist
    assert.equal(existsSync(join(e, 'apps')), false, 'empty pack must not have apps/');
    assert.equal(existsSync(join(e, 'instances')), false, 'empty pack must not have instances/');
    assert.equal(existsSync(join(e, 'FILES.yaml')), false);
    assert.equal(existsSync(join(e, 'BACKUP.yaml')), false);
    assert.equal(existsSync(join(e, 'files')), false);
    assert.equal(existsSync(join(e, 'backups')), false);

    const er = readFileSync(join(e, 'README.md'), 'utf8');
    assert.match(er, /duration-empty-001/);
    assert.match(er, /idea-test-3/);
    assert.match(er, /EmptyDiskPanel/);
    assert.match(er, /IDEA_DISKS_ROOT/);
  });

  it('kolibri App Disk tree has META + apps + instance + content catalogue', () => {
    const k = join(FIX, 'kolibri');
    mustExist(join(k, 'META.yaml'), 'kolibri META');
    mustExist(join(k, 'apps/kolibri-1.0/compose.yaml'), 'kolibri app compose');
    mustExist(join(k, 'instances/kolibri-grade5a-001/compose.yaml'), 'kolibri instance compose');
    mustExist(join(k, 'instances/kolibri-grade5a-001/.env'), 'kolibri instance .env');
    mustExist(join(k, 'content/CONTENT.yaml'), 'kolibri CONTENT.yaml');
    mustExist(join(k, 'content/CONTENT.seeded.json'), 'kolibri CONTENT.seeded.json');
    mustExist(join(k, 'content/CONTENT.live.json'), 'kolibri CONTENT.live.json');
    mustExist(join(k, 'content/seed-notes.md'), 'kolibri seed-notes');
    mustExist(join(k, 'content/seed/build_content_seeded.py'), 'kolibri seed builder');
    mustExist(join(k, 'content/media/video-grade5a-01.mp4'), 'kolibri video stub');

    const meta = readFileSync(join(k, 'META.yaml'), 'utf8');
    assert.match(meta, /diskId:\s*duration-kolibri-grade5a-001/);

    const content = readFileSync(join(k, 'content/CONTENT.yaml'), 'utf8');
    assert.match(content, /logicalId:\s*class-grade5a/);
    assert.match(content, /logicalId:\s*video-grade5a-01/);
    assert.match(content, /logicalId:\s*exercise-grade5a-01/);
    assert.match(content, /walkerAction:\s*open_video/);
    assert.match(content, /walkerAction:\s*open_exercise/);

    const seeded = JSON.parse(readFileSync(join(k, 'content/CONTENT.seeded.json'), 'utf8'));
    assert.equal(seeded.diskId, 'duration-kolibri-grade5a-001');
    assert.equal(seeded.instanceId, 'kolibri-grade5a-001');
    assert.ok(seeded.intentResolution?.open_video?.contentId);
    assert.ok(seeded.intentResolution?.open_exercise?.contentId);
    assert.equal(seeded.resources['video-grade5a-01'].logicalId, 'video-grade5a-01');
    assert.equal(seeded.resources['exercise-grade5a-01'].logicalId, 'exercise-grade5a-01');
    assert.match(seeded.intentResolution.open_video.storagePath, /content\/storage\//);
    mustExist(join(k, seeded.intentResolution.open_video.storagePath), 'seeded video storage blob');

    // Perseus open_exercise (pinned contentId + non-empty assessment items)
    assert.equal(
      seeded.intentResolution.open_exercise.contentId,
      '7eb9de46-96eb-53d0-bcc1-2fb270b96f03',
    );
    assert.ok(Array.isArray(seeded.intentResolution.open_exercise.assessmentItemIds));
    assert.equal(seeded.intentResolution.open_exercise.assessmentItemIds.length, 2);
    mustExist(join(k, 'content/seed/exercise-grade5a-01.perseus'), 'kolibri perseus archive');
    mustExist(join(k, 'content/seed/build_perseus_exercise.py'), 'kolibri perseus builder');
    mustExist(join(k, seeded.intentResolution.open_exercise.storagePath), 'seeded perseus storage blob');

    const live = JSON.parse(readFileSync(join(k, 'content/CONTENT.live.json'), 'utf8'));
    assert.equal(live.diskId, 'duration-kolibri-grade5a-001');
    assert.equal(live.instanceId, 'kolibri-grade5a-001');
    // Intent pins flipped to Khan EN-US remap (idea#168); synthetic smoke kept separate
    assert.equal(live.channel.channelId, 'c9d7f950-ab6b-5a11-99e3-d6c10d7f0103');
    assert.equal(live.intentResolution.open_video.contentId, '757e1a6e-9ea1-5168-b99a-0bf7eeb30662');
    assert.equal(live.intentResolution.open_exercise.contentId, '2f9204d3-af37-58b9-8fa0-fd86a0c03c5d');
    assert.equal(live.liveImportStatus, 'khan_remap_primary_idea04');
    assert.ok(live.facility.id);
    assert.ok(live.class.id);
    assert.ok(live.lesson.id);
    assert.equal(live.syntheticSmokeFallback.open_video_contentId, seeded.intentResolution.open_video.contentId);
    assert.equal(live.syntheticSmokeFallback.open_exercise_contentId, seeded.intentResolution.open_exercise.contentId);
    assert.equal(live.syntheticSmokeFallback.channelId, '30b6c263-4b96-5a62-93bd-dcf9a5cad7ca');
    mustExist(join(k, 'content/CONTENT.khan-remap.json'), 'kolibri CONTENT.khan-remap.json');

    const compose = readFileSync(join(k, 'apps/kolibri-1.0/compose.yaml'), 'utf8');
    assert.match(compose, /name:\s*kolibri/);
    assert.match(compose, /koenswings\/kolibri:1\.0-0\.15\.5-dev/);
    assert.doesNotMatch(compose, /password\s*[:=]\s*['"]?(?!\$\{)[^'"\s]+/i);
  });

  it('nextcloud App+Files Disk tree has META, FILES, filesMount, preload folders', () => {
    const n = join(FIX, 'nextcloud');
    mustExist(join(n, 'META.yaml'), 'nextcloud META');
    mustExist(join(n, 'content/CONTENT.live.json'), 'nextcloud CONTENT.live.json');
    mustExist(join(n, 'FILES.yaml'), 'nextcloud FILES');
    mustExist(join(n, 'CONTENT.yaml'), 'nextcloud CONTENT');
    mustExist(join(n, 'apps/nextcloud-1.0/compose.yaml'), 'nextcloud app compose');
    mustExist(join(n, 'apps/nextcloud-1.0/idea-files-entrypoint.sh'), 'idea-files entrypoint');
    mustExist(
      join(n, 'apps/nextcloud-1.0/docker-entrypoint-hooks.d/before-starting/10-idea-files.sh'),
      'idea-files hook',
    );
    mustExist(join(n, 'instances/nextcloud-grade5a-001/compose.yaml'), 'nextcloud instance compose');
    mustExist(join(n, 'instances/nextcloud-grade5a-001/.env'), 'nextcloud instance .env');

    mustExist(join(n, 'files/Class Materials/welcome.txt'), 'Class Materials');
    mustExist(join(n, 'files/Drop Zone/README.md'), 'Drop Zone');
    mustExist(join(n, 'files/Collab/Grade5A-collab-notes.md'), 'collab stub');

    const meta = readFileSync(join(n, 'META.yaml'), 'utf8');
    assert.match(meta, /diskId:\s*duration-nextcloud-grade5a-001/);

    const compose = readFileSync(join(n, 'apps/nextcloud-1.0/compose.yaml'), 'utf8');
    assert.match(compose, /filesMount:/);
    assert.match(compose, /koenswings\/nextcloud:1\.0-31\.0\.1/);
    // Collabora deferred — placeholder collab doc only (no code service image)
    assert.doesNotMatch(compose, /image:\s*koenswings\/nextcloud-code/);
    assert.doesNotMatch(compose, /^\s*code:\s*$/m);

    const content = readFileSync(join(n, 'CONTENT.yaml'), 'utf8');
    assert.match(content, /name:\s*Grade 5A/);
    assert.match(content, /folder-drop-grade5a/);
    assert.match(content, /collab-grade5a-01/);
    assert.match(content, /placeholder-doc/);
  });

  it('kiwix is explicitly deferred (Phase 3 / optional)', () => {
    const readme = readFileSync(join(FIX, 'kiwix/README.md'), 'utf8');
    assert.match(readme, /deferred|Phase 3|Steve deferral|omit/i);
    // No App Disk tree shipped yet
    assert.equal(existsSync(join(FIX, 'kiwix/META.yaml')), false);
  });

  it('walker-ref.yaml points at stable diskIds, locked Phase 1–2 keys, and notes #159', () => {
    const ref = read('walker-ref.yaml');
    assert.match(ref, /duration-empty-001/);
    assert.match(ref, /duration-kolibri-grade5a-001/);
    assert.match(ref, /duration-kolibri-form3-001/);
    assert.match(ref, /duration-nextcloud-grade5a-001/);
    assert.match(ref, /video-grade5a-01/);
    assert.match(ref, /folder-drop-grade5a/);
    assert.match(ref, /idea#159/);
    assert.match(ref, /kiwix:[\s\S]*included:\s*false/);
    // Axle-locked Phase 1–2 action keys
    for (const key of [
      'open_console_as_teacher',
      'open_console_as_learner',
      'open_console_as_operator',
      'enter_infra_fleet_walk',
      'return_to_start',
      'stay_on_teacher_overview',
      'stay_on_learner_overview',
      'infra_undock_fixtures',
      'infra_dock_fixture',
      'infra_move_disk',
      'infra_reboot_engine',
    ]) {
      assert.match(ref, new RegExp(key));
    }
    // Future deeper Intents are snake_case
    assert.match(ref, /open_video:/);
    assert.match(ref, /open_file_drop:/);
    // Phase 3 App-owned deeper Intent map
    assert.match(ref, /pack_version:\s*"1\.5"/);
    assert.match(ref, /id_stability:/);
    assert.match(ref, /contentLive:/);
    assert.match(ref, /mutable_on_reprovision:/);
    assert.match(ref, /phase_3_intents:/);
    for (const key of [
      'open_kolibri_as_teacher',
      'open_kolibri_as_learner',
      'open_nextcloud_as_teacher',
      'open_nextcloud_as_learner',
      'keep_watching',
      'next_resource',
      'exit_lesson',
      'build_lesson',
      'share_to_class',
      'open_disk_inventory',
    ]) {
      assert.match(ref, new RegExp(key));
    }
    assert.match(ref, /selector_binding:\s*Pixel Phase 3/);
    assert.match(ref, /blocked_until_collabora|Collabora/);
    assert.match(ref, /Kiwix App Disk omitted/);
    assert.match(ref, /contentSeeded:/);
    assert.match(ref, /live_imported_idea01_2026-10-01/);
    assert.match(ref, /CONTENT\.live\.json/);
    assert.match(ref, /Steve deferral list/);
  });


  it('kolibri Form3 pack + G5A Khan remap pins exist (Studio public, no token)', () => {
    const f3 = join(FIX, 'kolibri-form3');
    mustExist(join(f3, 'META.yaml'), 'form3 META');
    mustExist(join(f3, 'apps/kolibri-1.0/compose.yaml'), 'form3 app compose');
    mustExist(join(f3, 'instances/kolibri-form3-001/compose.yaml'), 'form3 instance compose');
    mustExist(join(f3, 'content/CONTENT.yaml'), 'form3 CONTENT.yaml');
    mustExist(join(f3, 'content/CONTENT.seeded.json'), 'form3 CONTENT.seeded.json');
    mustExist(join(f3, 'content/CONTENT.live.json'), 'form3 CONTENT.live.json');
    mustExist(join(f3, 'content/seed-notes.md'), 'form3 seed-notes');

    const meta = readFileSync(join(f3, 'META.yaml'), 'utf8');
    assert.match(meta, /diskId:\s*duration-kolibri-form3-001/);

    const seeded = JSON.parse(readFileSync(join(f3, 'content/CONTENT.seeded.json'), 'utf8'));
    assert.equal(seeded.diskId, 'duration-kolibri-form3-001');
    assert.equal(seeded.instanceId, 'kolibri-form3-001');
    assert.equal(seeded.channel.channelIdRaw, 'c9d7f950ab6b5a1199e3d6c10d7f0103');
    assert.equal(seeded.intentResolution.open_video.contentIdRaw, '0a2fdaad532c56b2b90f62f9204e3be8');
    assert.equal(seeded.intentResolution.open_exercise.contentIdRaw, 'ed0c23b8e517568790ae1bda74ab22ba');
    assert.equal(seeded.allLeaves.videos.length, 3);
    assert.equal(seeded.allLeaves.exercises.length, 3);
    assert.ok(seeded.allLeaves.videos.every((l) => l.status === 'OK'));
    assert.ok(seeded.allLeaves.exercises.every((l) => l.status === 'OK'));

    const remap = JSON.parse(
      readFileSync(join(FIX, 'kolibri/content/CONTENT.khan-remap.json'), 'utf8'),
    );
    assert.equal(remap.diskId, 'duration-kolibri-grade5a-001');
    assert.equal(remap.channel.channelIdRaw, 'c9d7f950ab6b5a1199e3d6c10d7f0103');
    assert.equal(remap.channel.studioTokenRequired, false);
    assert.equal(remap.topic.nodeIdRaw, '4a5b44d4826e511b8bb2e568b9562c5c');
    assert.equal(remap.leaves.videos.length, 3);
    assert.equal(remap.leaves.exercises.length, 3);
    assert.ok(remap.leaves.videos.every((l) => l.status === 'OK'));
    assert.ok(remap.leaves.exercises.every((l) => l.status === 'OK'));
    assert.equal(remap.status, 'live_imported_verified_idea04');
    assert.equal(remap.kolibriHttpPort, 18081);
    // Synthetic smoke pins unchanged
    assert.equal(
      remap.syntheticSmokeFallback.open_video_contentId,
      'e60662de-b15c-52f9-b003-359f7d91f8fd',
    );

    const f3live = JSON.parse(readFileSync(join(f3, 'content/CONTENT.live.json'), 'utf8'));
    assert.equal(f3live.liveImportStatus, 'imported_on_idea04');
    assert.equal(f3live.kolibriHttpPort, 18080);
    assert.equal(f3live.intentResolution.open_video.contentIdRaw, '0a2fdaad532c56b2b90f62f9204e3be8');
    assert.equal(f3live.intentResolution.open_exercise.contentIdRaw, 'ed0c23b8e517568790ae1bda74ab22ba');
    assert.ok(f3live.facility.id);
    assert.ok(f3live.lesson.id);

    mustExist(
      join(ROOT, 'scripts/import-khan-topic-slice.sh'),
      'khan topic-slice import script',
    );
    mustExist(
      join(ROOT, 'scripts/provision-khan-pack-lesson.py'),
      'khan pack provision script',
    );
    mustExist(join(ROOT, 'SIDECARS.live.md'), 'sidecar docs');
  });

  it('CONTENT catalogues expose phase_3_intent_map', () => {
    const k = readFileSync(join(FIX, 'kolibri/content/CONTENT.yaml'), 'utf8');
    assert.match(k, /phase_3_intent_map:/);
    assert.match(k, /open_kolibri_as_teacher:/);
    assert.match(k, /open_video:/);
    const n = readFileSync(join(FIX, 'nextcloud/CONTENT.yaml'), 'utf8');
    assert.match(n, /phase_3_intent_map:/);
    assert.match(n, /open_nextcloud_as_learner:/);
    assert.match(n, /share_to_class:/);
  });

  it('README documents paths, Design Review gates, and locked Phase 1–2 keys', () => {
    const md = read('README.md');
    assert.match(md, /duration-empty-001/);
    assert.match(md, /duration-kolibri-grade5a-001/);
    assert.match(md, /duration-kolibri-form3-001/);
    assert.match(md, /duration-nextcloud-grade5a-001/);
    assert.match(md, /Versioned App fixtures/);
    assert.match(md, /idea#159/);
    assert.match(md, /Class-instance selectors/);
    assert.match(md, /infra_dock_fixture/);
    assert.match(md, /open_console_as_teacher/);
    assert.match(md, /return_to_start/);
    assert.match(md, /stay_on_learner_overview/);
    assert.match(md, /Phase 3 deeper Intents/);
    assert.match(md, /open_kolibri_as_teacher/);
    assert.match(md, /CONTENT\.seeded\.json/);
    assert.match(md, /CONTENT\.live\.json/);
    assert.match(md, /Stable vs mutable|Mutable on re-provision/i);
    assert.match(md, /selector_binding|Pixel Phase 3/);
    assert.match(md, /EmptyDiskPanel/);
    assert.match(md, /idea-test-3/);
    assert.match(md, /install_app/);
    assert.match(md, /make_files_disk/);
    assert.match(md, /make_backup_disk/);
  });

  it('fixture trees contain only expected top-level packs', () => {
    const packs = readdirSync(FIX).filter((n) => statSync(join(FIX, n)).isDirectory()).sort();
    assert.deepEqual(packs, ['empty', 'kiwix', 'kolibri', 'kolibri-form3', 'nextcloud']);
  });
});
