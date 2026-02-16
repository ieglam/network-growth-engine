import { PrismaClient, ScoringConfigType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ─── Default Categories (PRD §5 Priority Score) ──────────────────────────
  const categories = [
    { name: 'Crypto Client', relevanceWeight: 10 },
    { name: 'Regulator / Policy Official', relevanceWeight: 9 },
    { name: 'Potential Employer / Hiring Manager', relevanceWeight: 9 },
    { name: 'Chief of Staff / Operator', relevanceWeight: 7 },
    { name: 'MBA Network', relevanceWeight: 6 },
    { name: 'Mexico City Fintech / Expat', relevanceWeight: 6 },
    { name: 'General Industry Contact', relevanceWeight: 3 },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: { relevanceWeight: cat.relevanceWeight },
      create: cat,
    });
  }
  console.log(`  ✓ ${categories.length} categories seeded`);

  // ─── Relationship Scoring Weights (PRD §5 Relationship Strength) ─────────
  const relationshipWeights: { key: string; value: number }[] = [
    { key: 'meeting_1on1_inperson', value: 15 },
    { key: 'meeting_1on1_virtual', value: 10 },
    { key: 'meeting_group', value: 5 },
    { key: 'email', value: 5 },
    { key: 'linkedin_message', value: 4 },
    { key: 'linkedin_comment_given', value: 3 },
    { key: 'linkedin_comment_received', value: 3 },
    { key: 'linkedin_like_given', value: 1 },
    { key: 'linkedin_like_received', value: 1 },
    { key: 'introduction_given', value: 10 },
    { key: 'introduction_received', value: 10 },
    { key: 'manual_note', value: 8 },
    { key: 'connection_request_sent', value: 3 },
    { key: 'connection_request_accepted', value: 2 },
    { key: 'linkedin_dm_sent', value: 2 },
    { key: 'linkedin_dm_received', value: 3 },
  ];

  for (const w of relationshipWeights) {
    await prisma.scoringConfig.upsert({
      where: {
        configType_key: {
          configType: ScoringConfigType.relationship_weight,
          key: w.key,
        },
      },
      update: { value: w.value },
      create: {
        configType: ScoringConfigType.relationship_weight,
        key: w.key,
        value: w.value,
      },
    });
  }
  console.log(`  ✓ ${relationshipWeights.length} relationship weights seeded`);

  // ─── Priority Formula Weights (PRD §5 Priority Score) ────────────────────
  const priorityWeights: { key: string; value: number }[] = [
    { key: 'relevance', value: 0.5 },
    { key: 'accessibility', value: 0.3 },
    { key: 'timing', value: 0.2 },
  ];

  for (const w of priorityWeights) {
    await prisma.scoringConfig.upsert({
      where: {
        configType_key: {
          configType: ScoringConfigType.priority_weight,
          key: w.key,
        },
      },
      update: { value: w.value },
      create: {
        configType: ScoringConfigType.priority_weight,
        key: w.key,
        value: w.value,
      },
    });
  }
  console.log(`  ✓ ${priorityWeights.length} priority weights seeded`);

  // ─── Timing Trigger Bonuses (PRD §5 Timing) ─────────────────────────────
  const timingTriggers: { key: string; value: number }[] = [
    { key: 'job_change_30d', value: 3 },
    { key: 'linkedin_post_7d', value: 2 },
    { key: 'company_funding_news', value: 2 },
    { key: 'same_upcoming_event', value: 3 },
    { key: 'geographic_overlap_30d', value: 2 },
    { key: 'profile_view', value: 1 },
    { key: 'mutual_connection_activity', value: 1 },
  ];

  for (const t of timingTriggers) {
    await prisma.scoringConfig.upsert({
      where: {
        configType_key: {
          configType: ScoringConfigType.timing_trigger,
          key: t.key,
        },
      },
      update: { value: t.value },
      create: {
        configType: ScoringConfigType.timing_trigger,
        key: t.key,
        value: t.value,
      },
    });
  }
  console.log(`  ✓ ${timingTriggers.length} timing triggers seeded`);

  // ─── Status Transition Thresholds ────────────────────────────────────────
  const thresholds: { key: string; value: number }[] = [
    { key: 'connected_to_engaged_score', value: 30 },
    { key: 'connected_to_engaged_interactions', value: 2 },
    { key: 'engaged_to_relationship_score', value: 60 },
    { key: 'engaged_to_relationship_reciprocal', value: 1 },
    { key: 'demotion_consecutive_days', value: 30 },
  ];

  for (const t of thresholds) {
    await prisma.scoringConfig.upsert({
      where: {
        configType_key: {
          configType: ScoringConfigType.status_threshold,
          key: t.key,
        },
      },
      update: { value: t.value },
      create: {
        configType: ScoringConfigType.status_threshold,
        key: t.key,
        value: t.value,
      },
    });
  }
  console.log(`  ✓ ${thresholds.length} status thresholds seeded`);

  // ─── General Config ──────────────────────────────────────────────────────
  const generalConfig: { key: string; value: number }[] = [
    { key: 'recency_half_life_days', value: 90 },
    { key: 'reciprocity_threshold_pct', value: 30 },
    { key: 'reciprocity_multiplier_min', value: 1.3 },
    { key: 'reciprocity_multiplier_max', value: 1.5 },
    { key: 'seniority_multiplier_c_suite', value: 1.5 },
    { key: 'seniority_multiplier_vp', value: 1.5 },
    { key: 'seniority_multiplier_director', value: 1.2 },
    { key: 'seniority_multiplier_manager', value: 1.0 },
    { key: 'seniority_multiplier_ic', value: 0.8 },
    { key: 'skip_priority_penalty', value: -1 },
  ];

  for (const c of generalConfig) {
    await prisma.scoringConfig.upsert({
      where: {
        configType_key: {
          configType: ScoringConfigType.general,
          key: c.key,
        },
      },
      update: { value: c.value },
      create: {
        configType: ScoringConfigType.general,
        key: c.key,
        value: c.value,
      },
    });
  }
  console.log(`  ✓ ${generalConfig.length} general config values seeded`);

  // ─── Sample Templates (≤300 chars each) ──────────────────────────────────
  const templates = [
    {
      name: 'Crypto Exec - Mutual Interest',
      persona: 'crypto_exec',
      body: 'Hi {{first_name}}, I work in crypto compliance and see we share interests in the space. Would love to connect and exchange perspectives on where the industry is heading.',
    },
    {
      name: 'MBA Network - Alumni',
      persona: 'mba',
      body: "Hi {{first_name}}, fellow MBA here! I noticed you're at {{company}} — would love to connect and stay in touch as we build our networks.",
    },
    {
      name: 'General - Shared Industry',
      persona: 'general',
      body: "Hi {{first_name}}, I came across your profile and noticed we're both in the {{category_context}} space. Would love to connect!",
    },
  ];

  for (const t of templates) {
    const existing = await prisma.template.findFirst({
      where: { name: t.name },
    });
    if (!existing) {
      await prisma.template.create({ data: t });
    }
  }
  console.log(`  ✓ ${templates.length} sample templates seeded`);

  // ─── Default Settings ────────────────────────────────────────────────────
  const settings: { key: string; value: string }[] = [
    { key: 'queue_generation_hour', value: '7' },
    { key: 'linkedin_weekly_limit', value: '100' },
    { key: 'linkedin_daily_limit', value: '20' },
    { key: 'cooldown_days', value: '7' },
    { key: 'guided_mode', value: 'true' },
    { key: 'notification_morning', value: 'true' },
    { key: 'notification_afternoon', value: 'true' },
  ];

  for (const s of settings) {
    await prisma.settings.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log(`  ✓ ${settings.length} default settings seeded`);

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
