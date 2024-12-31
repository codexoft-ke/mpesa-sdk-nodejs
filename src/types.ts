
export interface MpesaConfig {
    env: 'production' | 'sandbox';
    requester: string;
    shortCodeType: 'till' | 'paybill';
    businessShortCode: string;
    credentials: {
        passKey: string;
        initiatorName: string;
        initiatorPass: string;
    };
    appInfo: {
        consumerKey: string;
        consumerSecret: string;
    };
}

export interface MpesaResponse {
    response: any;
    httpCode: number;
}

export interface STKPushResponse {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResponseCode: string;
    ResponseDescription: string;
    CustomerMessage: string;
}

export interface B2CResponse {
    ConversationID: string;
    OriginatorConversationID: string;
    ResponseCode: string;
    ResponseDescription: string;
}

export interface QRCodeResponse {
    QRCode: string;
    ResponseCode: string;
    ResponseDescription: string;
}

export interface TransactionStatusResponse {
    ResponseCode: string;
    ResponseDescription: string;
    OriginatorConversationID: string;
    ConversationID: string;
    TransactionID: string;
}

export interface AccountBalanceResponse {
    ConversationID: string;
    OriginatorConversationID: string;
    ResponseCode: string;
    ResponseDescription: string;
}

export interface OrganizationResponse {
    OrganizationName: string;
    OrganizationType: string;
    ResponseCode: string;
    ResponseDescription: string;
}

export type CommandID = 
    | 'SalaryPayment'
    | 'BusinessPayment'
    | 'PromotionPayment';

export type PaymentType = 
    | 'PaybillToPaybill'
    | 'PaybillToTill'
    | 'B2BAccountTopUp';