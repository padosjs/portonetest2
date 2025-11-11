import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import axios from 'axios';

// Supabase 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 포트원 API 설정
const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET!;
const PORTONE_API_BASE = 'https://api.portone.io';

// 타입 정의
interface WebhookPayload {
  payment_id: string;
  status: 'Paid' | 'Cancelled';
}

interface PortonePayment {
  id: string;
  paymentId?: string;
  amount: {
    total: number;
  };
  orderName: string;
  billingKey?: string;
  customer: {
    id: string;
  };
}

interface PaymentRecord {
  transaction_key: string;
  amount: number;
  status: string;
  start_at: string;
  end_at: string;
  end_grace_at: string;
  next_schedule_at: string;
  next_schedule_id: string;
}

interface ScheduleItem {
  id: string;
  paymentId: string;
}

interface PaymentScheduleResponse {
  items: ScheduleItem[];
}

export async function POST(request: NextRequest) {
  try {
    // 1. 웹훅 페이로드 파싱
    const payload: WebhookPayload = await request.json();
    console.log('포트원 웹훅 수신:', payload);

    const paymentId = payload.payment_id;

    // 2. Paid 시나리오 처리
    if (payload.status === 'Paid') {
      return await handlePaidScenario(paymentId);
    }

    // 3. Cancelled 시나리오 처리
    if (payload.status === 'Cancelled') {
      return await handleCancelledScenario(paymentId);
    }

    // 4. 알 수 없는 상태
    console.log('알 수 없는 상태:', payload.status);
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('웹훅 처리 중 오류 발생:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류' 
      },
      { status: 500 }
    );
  }
}

// Paid 시나리오 처리 함수
async function handlePaidScenario(paymentId: string) {

    // 3. 포트원에서 결제 정보 조회
    console.log('결제 정보 조회 중:', paymentId);
    const paymentResponse = await fetch(`${PORTONE_API_BASE}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `PortOne ${PORTONE_API_SECRET}`,
      },
    });

    if (!paymentResponse.ok) {
      const errorText = await paymentResponse.text();
      console.error('포트원 결제 정보 조회 실패:', errorText);
      throw new Error(`포트원 결제 정보 조회 실패: ${paymentResponse.status}`);
    }

    const paymentData: PortonePayment = await paymentResponse.json();
    console.log('결제 정보 조회 성공:', paymentData);

    // 4. 날짜 계산
    const now = new Date();
    const startAt = now.toISOString();
    
    const endAt = new Date(now);
    endAt.setDate(endAt.getDate() + 30);
    
    const endGraceAt = new Date(now);
    endGraceAt.setDate(endGraceAt.getDate() + 31);
    
    // next_schedule_at: end_at + 1일 오전 10시~11시 사이 임의 시각
    const nextScheduleAt = new Date(endAt);
    nextScheduleAt.setDate(nextScheduleAt.getDate() + 1);
    nextScheduleAt.setHours(10, Math.floor(Math.random() * 60), 0, 0); // 10시 00분 ~ 10시 59분
    
    const nextScheduleId = randomUUID();

    // 5. Supabase payment 테이블에 저장
    console.log('Supabase에 결제 정보 저장 중...');
    const { data: paymentRecord, error: insertError } = await supabase
      .from('payment')
      .insert({
        transaction_key: paymentId,
        amount: paymentData.amount.total,
        status: 'Paid',
        start_at: startAt,
        end_at: endAt.toISOString(),
        end_grace_at: endGraceAt.toISOString(),
        next_schedule_at: nextScheduleAt.toISOString(),
        next_schedule_id: nextScheduleId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Supabase 저장 실패:', insertError);
      throw new Error(`Supabase 저장 실패: ${insertError.message}`);
    }

    console.log('Supabase 저장 성공:', paymentRecord);

    // 6. billingKey가 있는 경우에만 다음 달 구독 예약
    if (paymentData.billingKey) {
      console.log('다음 달 구독 예약 중...');
      
      const scheduleResponse = await fetch(
        `${PORTONE_API_BASE}/payments/${nextScheduleId}/schedule`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `PortOne ${PORTONE_API_SECRET}`,
          },
          body: JSON.stringify({
            payment: {
              billingKey: paymentData.billingKey,
              orderName: paymentData.orderName,
              customer: {
                id: paymentData.customer.id,
              },
              amount: {
                total: paymentData.amount.total,
              },
              currency: 'KRW',
            },
            timeToPay: nextScheduleAt.toISOString(),
          }),
        }
      );

      if (!scheduleResponse.ok) {
        const errorText = await scheduleResponse.text();
        console.error('포트원 스케줄 등록 실패:', errorText);
        // 스케줄 등록 실패는 로그만 남기고 성공 응답 반환 (결제 저장은 성공했으므로)
      } else {
        console.log('다음 달 구독 예약 성공');
      }
    } else {
      console.log('billingKey가 없어 구독 예약을 건너뜁니다.');
    }

  // 7. 성공 응답
  return NextResponse.json({ 
    success: true,
    message: '웹훅 처리 완료',
    payment: paymentRecord
  });
}

// Cancelled 시나리오 처리 함수
async function handleCancelledScenario(paymentId: string) {
  // 3-1-1) paymentId의 결제정보를 조회
  console.log('결제 정보 조회 중:', paymentId);
  const paymentResponse = await fetch(`${PORTONE_API_BASE}/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `PortOne ${PORTONE_API_SECRET}`,
    },
  });

  if (!paymentResponse.ok) {
    const errorText = await paymentResponse.text();
    console.error('포트원 결제 정보 조회 실패:', errorText);
    throw new Error(`포트원 결제 정보 조회 실패: ${paymentResponse.status}`);
  }

  const paymentData: PortonePayment = await paymentResponse.json();
  console.log('결제 정보 조회 성공:', paymentData);

  // 3-1-2) supabase의 테이블에서 다음을 조회
  // 조건: transaction_key === 결제정보.paymentId
  // paymentId는 웹훅에서 받은 payment_id 또는 결제정보의 id/paymentId
  const actualPaymentId = paymentData.paymentId || paymentData.id || paymentId;
  console.log('Supabase에서 기존 결제 정보 조회 중:', actualPaymentId);
  
  const { data: existingPayment, error: selectError } = await supabase
    .from('payment')
    .select('*')
    .eq('transaction_key', actualPaymentId)
    .eq('status', 'Paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (selectError || !existingPayment) {
    console.error('Supabase 조회 실패:', selectError);
    throw new Error(`기존 결제 정보를 찾을 수 없습니다: ${selectError?.message || '데이터 없음'}`);
  }

  console.log('기존 결제 정보 조회 성공:', existingPayment);

  // 3-1-3) supabase의 테이블에 다음을 등록
  const cancelRecord: Partial<PaymentRecord> = {
    transaction_key: existingPayment.transaction_key,
    amount: -existingPayment.amount, // 음수로 저장
    status: 'Cancel',
    start_at: existingPayment.start_at,
    end_at: existingPayment.end_at,
    end_grace_at: existingPayment.end_grace_at,
    next_schedule_at: existingPayment.next_schedule_at,
    next_schedule_id: existingPayment.next_schedule_id,
  };

  console.log('Supabase에 취소 정보 저장 중...');
  const { data: cancelPaymentRecord, error: insertError } = await supabase
    .from('payment')
    .insert(cancelRecord)
    .select()
    .single();

  if (insertError) {
    console.error('Supabase 취소 정보 저장 실패:', insertError);
    throw new Error(`Supabase 취소 정보 저장 실패: ${insertError.message}`);
  }

  console.log('Supabase 취소 정보 저장 성공:', cancelPaymentRecord);

  // 3-2) 다음달구독예약취소시나리오
  // 3-2-1) 예약된 결제정보를 조회
  if (paymentData.billingKey && existingPayment.next_schedule_at && existingPayment.next_schedule_id) {
    console.log('예약된 결제 스케줄 조회 중...');
    
    // next_schedule_at 기준으로 ±1일 범위 설정
    const scheduleDate = new Date(existingPayment.next_schedule_at);
    const fromDate = new Date(scheduleDate);
    fromDate.setDate(fromDate.getDate() - 1);
    const untilDate = new Date(scheduleDate);
    untilDate.setDate(untilDate.getDate() + 1);

    try {
      // GET 요청에 바디를 포함해야 하므로 axios.request 사용
      const scheduleResponse = await axios.request<PaymentScheduleResponse>({
        method: 'GET',
        url: `${PORTONE_API_BASE}/payment-schedules`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${PORTONE_API_SECRET}`,
        },
        data: {
          filter: {
            billingKey: paymentData.billingKey,
            from: fromDate.toISOString(),
            until: untilDate.toISOString(),
          },
        },
      });

      console.log('예약된 결제 스케줄 조회 성공:', scheduleResponse.data);

      // 3-2-2) 예약된 결제정보의 조회결과 items를 순회하여 schedule객체의 id를 추출
      // 조건: items.paymentId === 조회결과.next_schedule_id
      const scheduleItems = scheduleResponse.data.items || [];
      const targetSchedule = scheduleItems.find(
        (item) => item.paymentId === existingPayment.next_schedule_id
      );

      if (targetSchedule) {
        console.log('취소할 스케줄 찾음:', targetSchedule.id);

        // 3-2-3) 포트원에 다음달 구독예약을 취소
        const cancelScheduleResponse = await fetch(
          `${PORTONE_API_BASE}/payment-schedules`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `PortOne ${PORTONE_API_SECRET}`,
            },
            body: JSON.stringify({
              scheduleIds: [targetSchedule.id],
            }),
          }
        );

        if (!cancelScheduleResponse.ok) {
          const errorText = await cancelScheduleResponse.text();
          console.error('포트원 스케줄 취소 실패:', errorText);
          // 스케줄 취소 실패는 로그만 남기고 성공 응답 반환 (취소 저장은 성공했으므로)
        } else {
          console.log('다음 달 구독 예약 취소 성공');
        }
      } else {
        console.log('취소할 스케줄을 찾을 수 없습니다.');
      }
    } catch (scheduleError) {
      console.error('스케줄 조회/취소 중 오류:', scheduleError);
      // 스케줄 관련 오류는 로그만 남기고 성공 응답 반환 (취소 저장은 성공했으므로)
    }
  } else {
    console.log('billingKey 또는 next_schedule 정보가 없어 스케줄 취소를 건너뜁니다.');
  }

  // 성공 응답
  return NextResponse.json({ 
    success: true,
    message: '취소 처리 완료',
    payment: cancelPaymentRecord
  });
}

