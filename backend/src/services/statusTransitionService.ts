import { prisma } from '../lib/prisma.js';
import { ContactStatus, InteractionType, StatusTransitionTrigger } from '@prisma/client';

const RECIPROCAL_INTERACTION_TYPES: InteractionType[] = [
  'linkedin_comment_received',
  'linkedin_like_received',
  'introduction_received',
  'connection_request_accepted',
];

interface TransitionResult {
  contactId: string;
  fromStatus: ContactStatus;
  toStatus: ContactStatus;
  trigger: StatusTransitionTrigger;
  reason: string;
}

/**
 * Check and apply automated status transitions for a single contact.
 * Returns the transition if one occurred, null otherwise.
 */
export async function checkStatusTransition(contactId: string): Promise<TransitionResult | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
  });

  if (!contact) return null;

  const currentStatus = contact.status;

  // Check promotion: connected → engaged
  if (currentStatus === 'connected') {
    const interactionCount = await prisma.interaction.count({
      where: { contactId },
    });

    if (contact.relationshipScore >= 30 && interactionCount >= 2) {
      return applyTransition(
        contactId,
        'connected',
        'engaged',
        'automated_promotion',
        `Score ${contact.relationshipScore} >= 30 and ${interactionCount} interactions >= 2`
      );
    }
  }

  // Check promotion: engaged → relationship
  if (currentStatus === 'engaged') {
    const reciprocalCount = await prisma.interaction.count({
      where: {
        contactId,
        type: { in: RECIPROCAL_INTERACTION_TYPES },
      },
    });

    if (contact.relationshipScore >= 60 && reciprocalCount >= 1) {
      return applyTransition(
        contactId,
        'engaged',
        'relationship',
        'automated_promotion',
        `Score ${contact.relationshipScore} >= 60 and ${reciprocalCount} reciprocal interactions >= 1`
      );
    }
  }

  return null;
}

/**
 * Check demotion based on score being below threshold for 30 consecutive days.
 */
export async function checkDemotion(contactId: string): Promise<TransitionResult | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
  });

  if (!contact) return null;

  const currentStatus = contact.status;

  // relationship → engaged: score below 60 for 30 days
  if (currentStatus === 'relationship' && contact.relationshipScore < 60) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentHighScore = await prisma.scoreHistory.findFirst({
      where: {
        contactId,
        scoreType: 'relationship',
        scoreValue: { gte: 60 },
        recordedAt: { gte: thirtyDaysAgo },
      },
    });

    if (!recentHighScore) {
      return applyTransition(
        contactId,
        'relationship',
        'engaged',
        'automated_demotion',
        `Score ${contact.relationshipScore} below 60 for 30+ days`
      );
    }
  }

  // engaged → connected: score below 30 for 30 days
  if (currentStatus === 'engaged' && contact.relationshipScore < 30) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentHighScore = await prisma.scoreHistory.findFirst({
      where: {
        contactId,
        scoreType: 'relationship',
        scoreValue: { gte: 30 },
        recordedAt: { gte: thirtyDaysAgo },
      },
    });

    if (!recentHighScore) {
      return applyTransition(
        contactId,
        'engaged',
        'connected',
        'automated_demotion',
        `Score ${contact.relationshipScore} below 30 for 30+ days`
      );
    }
  }

  return null;
}

/**
 * Manually set a contact's status, bypassing guards.
 * Logs the transition in StatusHistory.
 */
export async function manualStatusTransition(
  contactId: string,
  newStatus: ContactStatus,
  reason?: string
): Promise<TransitionResult | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
  });

  if (!contact) return null;

  if (contact.status === newStatus) return null;

  return applyTransition(
    contactId,
    contact.status,
    newStatus,
    'manual',
    reason || `Manual status change to ${newStatus}`
  );
}

async function applyTransition(
  contactId: string,
  fromStatus: ContactStatus,
  toStatus: ContactStatus,
  trigger: StatusTransitionTrigger,
  reason: string
): Promise<TransitionResult> {
  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contactId },
      data: { status: toStatus },
    }),
    prisma.statusHistory.create({
      data: {
        contactId,
        fromStatus,
        toStatus,
        trigger,
        triggerReason: reason,
      },
    }),
  ]);

  return {
    contactId,
    fromStatus,
    toStatus,
    trigger,
    reason,
  };
}
