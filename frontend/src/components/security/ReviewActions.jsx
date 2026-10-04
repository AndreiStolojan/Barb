// The two review verbs for the open message. Mark safe is local; mark phishing
// also asks the backend to move the message to Gmail Spam. The buttons flip
// optimistically and roll back if the request fails. `onReviewed` receives the
// action result ({ action, email, providerAction }), not the email itself.
//
// A parent can drive the same actions from the keyboard through `ref`:
//   ref.current.review('safe' | 'phishing')

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { markEmailPhishing, markEmailSafe } from '@/api/actionsApi';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { emailId } from '@/lib/email';
import { cn } from '@/lib/utils';

export const ReviewActions = forwardRef(function ReviewActions({ email, onReviewed, disabled = false, className }, ref) {
  // The coral fill is a recommendation; only make it where the scan backs it.
  const urgent = email?.riskBucket === 'quarantine';
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
      // Marking phishing also asks Gmail to move the message to Spam. The
      // verdict is saved either way; a failed move is said, never swallowed.
      if (result?.providerAction?.status === 'failed') {
        toast.warning('Marked as phishing, but Gmail did not move it to Spam', {
          description: result.providerAction.message || 'The message is still in your Gmail inbox.',
        });
      } else if (kind === 'phishing' && result?.providerAction?.status === 'success') {
        toast.success('Marked as phishing · moved to Spam');
      } else {
        toast.success(kind === 'safe' ? 'Marked as safe' : 'Marked as phishing');
      }
      onReviewed?.(result);
    } catch (err) {
      setVerdict(previous);
      toast.error(err.message || 'The action failed. Try again.');
    }
  };

  useImperativeHandle(ref, () => ({ review }), [review]);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button
        variant={reviewedPhishing || !urgent ? 'outline' : 'phish'}
        size="lg"
        disabled={disabled || busy || reviewedPhishing}
        onClick={() => review('phishing')}
        className={cn(reviewedPhishing && 'text-risk-phishing disabled:opacity-100')}
      >
        {phishing.loading ? <Loader2 className="animate-spin" /> : reviewedPhishing && <Check />}
        {reviewedPhishing ? 'Marked as phishing' : 'Mark as phishing'}
      </Button>
      <Button
        variant="outline"
        size="lg"
        disabled={disabled || busy || reviewedSafe}
        onClick={() => review('safe')}
        className={cn(reviewedSafe && 'text-risk-safe disabled:opacity-100')}
      >
        {safe.loading ? <Loader2 className="animate-spin" /> : reviewedSafe && <Check />}
        {reviewedSafe ? 'Marked as safe' : 'Mark as safe'}
      </Button>
    </div>
  );
});
