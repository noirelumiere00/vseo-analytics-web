import Stripe from "stripe";
import { ENV } from "./env";
import * as db from "../db";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(ENV.stripeSecretKey, { apiVersion: "2025-04-30.basil" });
  }
  return _stripe;
}

const PRICE_MAP: Record<string, string> = {
  pro: ENV.stripePriceIdPro,
  business: ENV.stripePriceIdBusiness,
};

export async function createCheckoutSession(
  userId: number,
  plan: "pro" | "business",
  successUrl: string,
  cancelUrl: string,
) {
  const stripe = getStripe();
  const priceId = PRICE_MAP[plan];
  if (!priceId) throw new Error(`Invalid plan: ${plan}`);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId: String(userId), plan },
  });
  return session;
}

export async function createPortalSession(stripeCustomerId: string, returnUrl: string) {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return session;
}

export async function handleWebhookEvent(body: Buffer, signature: string) {
  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(body, signature, ENV.stripeWebhookSecret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = parseInt(session.metadata?.userId ?? "0", 10);
      const plan = (session.metadata?.plan ?? "pro") as "pro" | "business";
      if (!userId) break;

      await db.upsertSubscription({
        userId,
        plan,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string,
        status: "active",
      });
      console.log(`[Stripe] Checkout completed: userId=${userId}, plan=${plan}`);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const stripeSubId = sub.id;
      const existing = await db.getSubscriptionByStripeSubscriptionId(stripeSubId);
      if (!existing) break;

      await db.updateSubscriptionByStripeSubId(stripeSubId, {
        status: sub.status === "active" ? "active"
          : sub.status === "past_due" ? "past_due"
          : sub.status === "canceled" ? "canceled"
          : "incomplete",
        currentPeriodStart: new Date(sub.current_period_start * 1000),
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
      });
      console.log(`[Stripe] Subscription updated: ${stripeSubId}, status=${sub.status}`);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const existing = await db.getSubscriptionByStripeSubscriptionId(sub.id);
      if (!existing) break;

      await db.updateSubscriptionByStripeSubId(sub.id, {
        status: "canceled",
        plan: "free",
      });
      console.log(`[Stripe] Subscription deleted: ${sub.id}, reverted to free`);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.subscription as string;
      if (!subId) break;

      await db.updateSubscriptionByStripeSubId(subId, { status: "past_due" });
      console.log(`[Stripe] Payment failed: subscription=${subId}`);
      break;
    }
    default:
      // Unhandled event type
      break;
  }
}
