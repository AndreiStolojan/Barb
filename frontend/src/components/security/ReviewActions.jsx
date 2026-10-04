// The two review verbs for the open message. Mark safe is local; mark phishing
// also asks the backend to move the message to Gmail Spam. The buttons flip
// optimistically and roll back if the request fails.
//
// A parent can drive the same actions from the keyboard through `ref`:
//   ref.current.review('safe' | 'phishing')

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Check, Loader2, ShieldCheck, ShieldX } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { markEmailPhishing, markEmailSafe } from '@/api/actionsApi';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { emailId } from '@/lib/email';
import { cn } from '@/lib/utils';

export const ReviewActions = forwardRef(function ReviewActions({ email, onReviewed, disabled = false, hints = false, className }, ref) {
  const safe = useAsyncAction(markEmailSafe);
  const phishing = useAsyncAction(markEmailPhishing);
  const busy = safe.loading || phishing.loading;
  const [verdict, setVerdict] = useState(email?.userVerdict ?? null);

  useEffect(() => {
    setVerdict(email?.userVerdict ?? null);
  }, [email?.userVerdict, email?.id, email?._id]);

  const reviewedSafe = verdict === 'safe';
  const reviewedPhishing = verdict === 'phishing';

  const review = async (kind) => {
    if (disabled || busy || verdict === kind) return;
    const previous = verdict;
    setVerdict(kind);
    try {
      const result = await (kind === 'safe' ? safe : phishing).run(emailId(email));
      toast.success(kind === 'safe' ? 'Marked safe' : 'Marked phishing');
      onReviewed?.(result);
    } catch (err) {
      setVerdict(previous);
      toast.error(err.message || 'The action failed. Try again.');
    }
  };

  useImperativeHandle(ref, () => ({ review }), [review]);

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <Button
        variant={reviewedPhishing ? 'outline' : 'danger'}
        disabled={disabled || busy || reviewedPhishing}
        onClick={() => review('phishing')}
        className={cn(reviewedPhishing && 'border-risk-phishing/40 text-risk-phishing')}
      >
        {phishing.loading ? <Loader2 className="animate-spin" /> : reviewedPhishing ? <Check /> : <ShieldX />}
        {reviewedPhishing ? 'Marked phishing' : 'Mark phishing'}
        {hints && !reviewedPhishing && <Kbd className="max-md:hidden">P</Kbd>}
      </Button>
      <Button
        variant="outline"
        disabled={disabled || busy || reviewedSafe}
        onClick={() => review('safe')}
        className={cn(reviewedSafe && 'border-risk-safe/50 text-risk-safe')}
      >
        {safe.loading ? <Loader2 className="animate-spin" /> : reviewedSafe ? <Check /> : <ShieldCheck />}
        {reviewedSafe ? 'Marked safe' : 'Mark safe'}
        {hints && !reviewedSafe && <Kbd className="max-md:hidden">S</Kbd>}
      </Button>
    </div>
  );
});
