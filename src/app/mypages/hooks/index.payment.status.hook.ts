import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface PaymentStatus {
  isSubscribed: boolean;
  transactionKey: string | null;
  statusMessage: "구독중" | "Free";
}

interface Payment {
  transaction_key: string | null;
  created_at?: string;
  status: string;
  start_at: string;
  end_grace_at: string;
}

/**
 * 구독 상태 조회 Hook
 * payment 테이블에서 현재 활성 구독 상태를 조회합니다.
 */
export const usePaymentStatus = () => {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>({
    isSubscribed: false,
    transactionKey: null,
    statusMessage: "Free",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPaymentStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 1-1) payment 테이블의 목록 조회
      const { data: payments, error: fetchError } = await supabase
        .from("payment")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchError) {
        throw new Error(`결제 정보 조회 실패: ${fetchError.message}`);
      }

      if (!payments || payments.length === 0) {
        // 조회 결과 0건: Free
        setPaymentStatus({
          isSubscribed: false,
          transactionKey: null,
          statusMessage: "Free",
        });
        return;
      }

      // 1-1-1) 그룹화: transaction_key 그룹화
      // 1-1-2) 각 그룹에서 created_at 최신 1건씩 추출
      // (이미 created_at 내림차순으로 정렬되어 있으므로, 첫 번째로 나오는 transaction_key만 저장)
      const groupedPayments = new Map<string, Payment>();
      for (const payment of payments) {
        const key = payment.transaction_key;
        if (!key) continue;

        // 이미 해당 transaction_key가 있으면 스킵 (최신 레코드만 유지)
        if (!groupedPayments.has(key)) {
          groupedPayments.set(key, payment);
        }
      }

      // 1-1-2) 위 그룹 결과에서 조회:
      // 1) status === "Paid"
      // 2) start_at <= 현재시각 <= end_grace_at
      const now = new Date();
      const activePayments = Array.from(groupedPayments.values()).filter(
        (payment) => {
          if (payment.status !== "Paid") return false;

          const startAt = new Date(payment.start_at);
          const endGraceAt = new Date(payment.end_grace_at);

          return startAt <= now && now <= endGraceAt;
        }
      );

      // 1-2) 조회 결과에 따른 로직을 완성할 것.
      if (activePayments.length > 0) {
        // 조회 결과 1건 이상
        // - 상태메시지: 구독중
        // - "구독취소" 버튼 활성화 (isSubscribed: true)
        // - "구독취소" 버튼에 transaction_key 전달
        const latestPayment = activePayments[0];
        setPaymentStatus({
          isSubscribed: true,
          transactionKey: latestPayment.transaction_key,
          statusMessage: "구독중",
        });
      } else {
        // 조회 결과 0건
        // - 상태메시지: Free
        // - "구독하기" 버튼 활성화 (isSubscribed: false)
        setPaymentStatus({
          isSubscribed: false,
          transactionKey: null,
          statusMessage: "Free",
        });
      }
    } catch (err) {
      console.error("구독 상태 조회 중 오류:", err);
      setError(
        err instanceof Error ? err.message : "구독 상태 조회 중 오류가 발생했습니다."
      );
      setPaymentStatus({
        isSubscribed: false,
        transactionKey: null,
        statusMessage: "Free",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPaymentStatus();
  }, [fetchPaymentStatus]);

  return {
    paymentStatus,
    isLoading,
    error,
    refetch: fetchPaymentStatus,
  };
};

