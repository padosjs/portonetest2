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

        // 1. payment 테이블의 모든 데이터 조회
        const { data: payments, error: fetchError } = await supabase
          .from("payment")
          .select("*")
          .order("created_at", { ascending: false });

        if (fetchError) {
          throw new Error(`결제 정보 조회 실패: ${fetchError.message}`);
        }

        if (!payments || payments.length === 0) {
          setPaymentStatus({
            isSubscribed: false,
            transactionKey: null,
            statusMessage: "Free",
          });
          return;
        }

        // 2. transaction_key로 그룹화하고 각 그룹에서 created_at 최신 1건씩 추출
        const groupedPayments = new Map<string, Payment>();
        for (const payment of payments) {
          const key = payment.transaction_key;
          if (!key) continue;

          // 이미 해당 transaction_key의 최신 레코드가 있으면 스킵
          if (!groupedPayments.has(key)) {
            groupedPayments.set(key, payment);
          } else {
            const existing = groupedPayments.get(key);
            const existingDate = new Date(existing.created_at || 0);
            const currentDate = new Date(payment.created_at || 0);
            if (currentDate > existingDate) {
              groupedPayments.set(key, payment);
            }
          }
        }

        // 3. 그룹 결과에서 필터링
        // - status === "Paid"
        // - start_at <= 현재시각 <= end_grace_at
        const now = new Date();
        const activePayments = Array.from(groupedPayments.values()).filter(
          (payment) => {
            if (payment.status !== "Paid") return false;

            const startAt = new Date(payment.start_at);
            const endGraceAt = new Date(payment.end_grace_at);

            return startAt <= now && now <= endGraceAt;
          }
        );

        // 4. 조회 결과에 따른 상태 설정
        if (activePayments.length > 0) {
          // 조회 결과 1건 이상: 구독중
          const latestPayment = activePayments[0];
          setPaymentStatus({
            isSubscribed: true,
            transactionKey: latestPayment.transaction_key,
            statusMessage: "구독중",
          });
        } else {
          // 조회 결과 0건: Free
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

