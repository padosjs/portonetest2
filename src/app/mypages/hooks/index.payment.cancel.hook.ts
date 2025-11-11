import { useRouter } from "next/navigation";

export const usePaymentCancel = () => {
  const router = useRouter();

  /**
   * 구독 취소 처리
   * @returns 성공 여부 (boolean)
   */
  const handleCancelSubscription = async (transactionKey: string): Promise<boolean> => {
    try {
      // 1. 구독 취소 확인
      if (!confirm("구독을 취소하시겠습니까?")) {
        return false;
      }

      // 2. 구독 취소 API 요청
      const cancelApiResponse = await fetch("/api/payments/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionKey,
        }),
      });

      const cancelResult = await cancelApiResponse.json();

      // 3. 구독 취소 실패 처리
      if (!cancelResult.success) {
        alert(
          `구독 취소에 실패했습니다: ${
            cancelResult.error || "알 수 없는 오류"
          }`
        );
        return false;
      }

      // 4. 구독 취소 성공 처리
      alert("구독이 취소되었습니다.");
      router.push("/magazines");
      return true;
    } catch (error) {
      console.error("구독 취소 처리 중 오류:", error);
      alert("구독 취소 처리 중 오류가 발생했습니다.");
      return false;
    }
  };

  return {
    handleCancelSubscription,
  };
};

