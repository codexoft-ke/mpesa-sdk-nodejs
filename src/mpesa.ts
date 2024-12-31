import axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { MpesaException } from './exceptions';
import { MpesaConfig, MpesaResponse } from './types';

export class Mpesa {
    private readonly environment: string;
    private readonly requester: string;
    private readonly timeStamp: string;
    private readonly shortCodeType: 'till' | 'paybill';  // Update this line
    private readonly passKey: string;
    private readonly businessShortCode: string;
    private readonly baseUrl: string;
    private readonly consumerSecret: string;
    private readonly initiatorName: string;
    private readonly initiatorPass: string;
    private readonly consumerKey: string;
    private readonly shortCodePassword: string;
    private readonly securityCredential: string;

    constructor(config: MpesaConfig) {
        this.validateConfig(config);
        
        this.environment = config.env;
        this.requester = config.requester;
        this.timeStamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        this.shortCodeType = config.shortCodeType;
        this.passKey = config.credentials.passKey;
        this.businessShortCode = config.businessShortCode;
        this.baseUrl = (config.env === 'production') ? 
            'https://api.safaricom.co.ke' : 
            'https://sandbox.safaricom.co.ke';
        this.consumerSecret = config.appInfo.consumerSecret;
        this.initiatorName = config.credentials.initiatorName;
        this.initiatorPass = config.credentials.initiatorPass;
        this.consumerKey = config.appInfo.consumerKey;
        this.shortCodePassword = this.generatePassword();
        this.securityCredential = this.generateSecurityCredential();
    }

    private validateConfig(config: MpesaConfig): void {
        const requiredKeys: (keyof MpesaConfig)[] = ['env', 'credentials', 'appInfo', 'businessShortCode', 'shortCodeType', 'requester'];
        requiredKeys.forEach(key => {
            if (!config[key]) {
                throw new MpesaException(`Missing required configuration parameter: ${key}`);
            }
        });

        const requiredCredentials: (keyof MpesaConfig['credentials'])[] = ['passKey', 'initiatorPass', 'initiatorName'];
        requiredCredentials.forEach(key => {
            if (!config.credentials[key]) {
                throw new MpesaException(`Missing required credentials parameter: ${key}`);
            }
        });

        const requiredAppInfo: (keyof MpesaConfig['appInfo'])[] = ['consumerKey', 'consumerSecret'];
        requiredAppInfo.forEach(key => {
            if (!config.appInfo[key]) {
                throw new MpesaException(`Missing required appInfo parameter: ${key}`);
            }
        });
    }

    private generatePassword(): string {
        const password = `${this.businessShortCode}${this.passKey}${this.timeStamp}`;
        return Buffer.from(password).toString('base64');
    }

    private generateSecurityCredential(): string {
        const certificatePath = this.environment === 'production' 
            ? path.join(__dirname, '..', 'Certificates', 'ProductionCertificate.cer')
            : path.join(__dirname, '..', 'Certificates', 'SandboxCertificate.cer');
            
        const publicKey = fs.readFileSync(certificatePath);
        return crypto.publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_PADDING
            },
            Buffer.from(this.initiatorPass)
        ).toString('base64');
    }

    private async generateAccessToken(): Promise<string> {
        const url = `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`;
        const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');

        try {
            const response: AxiosResponse = await axios({
                method: 'get',
                url: url,
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.access_token) {
                return response.data.access_token;
            }

            throw new MpesaException('Failed to generate access token');
        } catch (error) {
            if (error instanceof Error) {
                throw new MpesaException(`Failed to generate access token: ${error.message}`);
            }
            throw new MpesaException('Failed to generate access token: Unknown error');
        }
    }

    private formatPhoneNumber(phoneNumber: string | number): string | null {
        if (!phoneNumber) return null;

        const numberStr = phoneNumber.toString();
        const numberLength = numberStr.length;
        
        switch(numberLength) {
            case 9:
                return `254${numberStr}`;
            case 10:
                return `254${numberStr.substring(1)}`;
            default:
                return numberStr.startsWith('254') ? 
                    numberStr : 
                    numberStr;
        }
    }

    private async sendRequest(endpoint: string, data: any): Promise<MpesaResponse> {
        try {
            const accessToken = await this.generateAccessToken();
            
            const response: AxiosResponse = await axios({
                method: 'post',
                url: `${this.baseUrl}/${endpoint}`,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                data: data
            });

            return {
                response: response.data,
                httpCode: response.status
            };
        } catch (error: any) {
            throw new MpesaException(
                error.response?.data?.errorMessage || 
                error.response?.data?.ResponseDescription || 
                error.message
            );
        }
    }

    public async getBusinessName(): Promise<string> {
        const orgInfo = await this.queryOrgInfo(this.shortCodeType, this.businessShortCode);
        return orgInfo.OrganizationName;
    }

    public async stkPush(
        amount: number,
        phoneNumber: string | number,
        accountNumber: string,
        callBackUrl: string,
        description: string = "STK Push Request"
    ): Promise<any> {
        if (!phoneNumber) throw new MpesaException("Phone number is required");
        if (!amount) throw new MpesaException("Amount is required");
        if (!accountNumber) throw new MpesaException("Account Number is required");
        if (!callBackUrl) throw new MpesaException("Callback url is required");

        const formattedPhone = this.formatPhoneNumber(phoneNumber);

        const response = await this.sendRequest("mpesa/stkpush/v1/processrequest", {
            Amount: amount,
            PartyA: formattedPhone,
            CallBackURL: callBackUrl,
            Timestamp: this.timeStamp,
            TransactionDesc: description,
            PhoneNumber: formattedPhone,
            PartyB: this.businessShortCode,
            AccountReference: accountNumber,
            TransactionType: 'CustomerPayBillOnline',
            BusinessShortCode: this.businessShortCode,
            Password: this.shortCodePassword
        });

        if (!response.response) {
            throw new MpesaException("No response received");
        }

        if (response.httpCode !== 200) {
            throw new MpesaException(
                response.response.ResponseMessage || 
                response.response.errorMessage || 
                `Request failed with status ${response.httpCode}`
            );
        }

        return response.response;
    }
    
        public async queryOrgInfo(
            type: 'till' | 'paybill',
            shortCode: string
        ): Promise<any> {
            let identifierType: number;
            switch (type) {
                case 'till':
                    identifierType = 2;
                    break;
                case 'paybill':
                    identifierType = 4;
                    break;
                default:
                    throw new MpesaException("Identifier type is not supported");
            }
    
            const response = await this.sendRequest("sfcverify/v1/query/info", {
                IdentifierType: identifierType,
                Identifier: shortCode
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async generateQRCode(
            amount: number,
            accountNumber: string,
            size: number = 300
        ): Promise<any> {
            if (!amount) throw new MpesaException("Amount is required");
    
            const response = await this.sendRequest("mpesa/qrcode/v1/generate", {
                MerchantName: await this.getBusinessName(),
                RefNo: accountNumber,
                Amount: amount,
                TrxCode: this.shortCodeType === "paybill" ? "PB" : "BG",
                CPI: this.businessShortCode,
                Size: size
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async stkPushQuery(checkoutRequestCode: string): Promise<any> {
            if (!checkoutRequestCode) {
                throw new MpesaException("Checkout request code is required");
            }
    
            const response = await this.sendRequest("mpesa/stkpushquery/v1/query", {
                BusinessShortCode: this.businessShortCode,
                Password: this.shortCodePassword,
                Timestamp: this.timeStamp,
                CheckoutRequestID: checkoutRequestCode
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async registerUrl(
            responseType: string,
            confirmationUrl: string,
            validationUrl: string
        ): Promise<any> {
            if (!confirmationUrl) throw new MpesaException("Confirmation url is required");
            if (!validationUrl) throw new MpesaException("Validation url is required");
    
            const response = await this.sendRequest("mpesa/c2b/v2/registerurl", {
                ShortCode: this.businessShortCode,
                ResponseType: responseType,
                ConfirmationURL: confirmationUrl,
                ValidationURL: validationUrl
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async initiateB2C(
            amount: number,
            phoneNumber: string | number,
            commandID: 'SalaryPayment' | 'BusinessPayment' | 'PromotionPayment',
            resultUrl: string,
            queueTimeoutUrl: string | null = null,
            remarks: string = "Business Payment"
        ): Promise<any> {
            if (!amount) throw new MpesaException("Amount is required");
            if (!phoneNumber) throw new MpesaException("Phone number is required");
            if (!resultUrl) throw new MpesaException("Result URL is required");
    
            const response = await this.sendRequest("mpesa/b2c/v1/paymentrequest", {
                InitiatorName: this.initiatorName,
                SecurityCredential: this.securityCredential,
                CommandID: commandID,
                Amount: amount,
                PartyA: this.businessShortCode,
                PartyB: this.formatPhoneNumber(phoneNumber),
                Remarks: remarks,
                QueueTimeOutURL: queueTimeoutUrl || resultUrl,
                ResultURL: resultUrl,
                Occasion: ''
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async transactionStatus(
            transactionID: string,
            resultUrl: string,
            queueTimeoutUrl: string | null = null
        ): Promise<any> {
            if (!transactionID) throw new MpesaException("Transaction ID is required");
            if (!resultUrl) throw new MpesaException("Result Url is required");
    
            const response = await this.sendRequest("mpesa/transactionstatus/v1/query", {
                Initiator: this.initiatorName,
                SecurityCredential: this.securityCredential,
                CommandID: 'TransactionStatusQuery',
                TransactionID: transactionID,
                PartyA: this.businessShortCode,
                IdentifierType: this.shortCodeType === 'paybill' ? '4' : '2',
                ResultURL: resultUrl,
                QueueTimeOutURL: queueTimeoutUrl || resultUrl,
                Remarks: 'Transaction Status Query',
                Occasion: ''
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async accountBalance(
            resultUrl: string,
            queueTimeoutUrl: string | null = null
        ): Promise<any> {
            if (!resultUrl) throw new MpesaException("Result Url is required");
    
            const response = await this.sendRequest("mpesa/accountbalance/v1/query", {
                Initiator: this.initiatorName,
                SecurityCredential: this.securityCredential,
                CommandID: 'AccountBalance',
                PartyA: this.businessShortCode,
                IdentifierType: this.shortCodeType === 'paybill' ? '4' : '2',
                ResultURL: resultUrl,
                QueueTimeOutURL: queueTimeoutUrl || resultUrl,
                Remarks: 'Account Balance Query',
                Occasion: ''
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async reverseTransaction(
            amount: number,
            transactionID: string,
            resultUrl: string,
            queueTimeoutUrl: string | null = null
        ): Promise<any> {
            if (!transactionID) throw new MpesaException("Transaction ID is required");
            if (!amount) throw new MpesaException("Amount is required");
            if (!resultUrl) throw new MpesaException("Result Url is required");
    
            const response = await this.sendRequest("mpesa/reversal/v1/request", {
                Initiator: this.initiatorName,
                SecurityCredential: this.securityCredential,
                CommandID: 'TransactionReversal',
                TransactionID: transactionID,
                Amount: amount,
                ReceiverParty: this.businessShortCode,
                RecieverIdentifierType: "11",
                ResultURL: resultUrl,
                QueueTimeOutURL: queueTimeoutUrl || resultUrl,
                Remarks: 'Transaction Reversal',
                Occasion: ''
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async taxRemittance(
            amount: number,
            paymentRegistrationNo: string,
            resultUrl: string,
            queueTimeoutUrl: string | null = null
        ): Promise<any> {
            if (!paymentRegistrationNo) throw new MpesaException("Payment Registration No is required");
            if (!amount) throw new MpesaException("Amount is required");
            if (!resultUrl) throw new MpesaException("Result Url is required");
    
            const response = await this.sendRequest("mpesa/b2b/v1/remittax", {
                Initiator: this.initiatorName,
                SecurityCredential: this.securityCredential,
                CommandID: 'PayTaxToKRA',
                SenderIdentifierType: '4',
                RecieverIdentifierType: '4',
                Amount: amount,
                PartyA: this.businessShortCode,
                PartyB: '572572',
                AccountReference: paymentRegistrationNo,
                Remarks: 'Tax Remittance',
                QueueTimeOutURL: queueTimeoutUrl || resultUrl,
                ResultURL: resultUrl
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async initiateB2B(
            amount: number,
            paymentType: 'PaybillToPaybill' | 'PaybillToTill' | 'B2BAccountTopUp',
            shortCode: string,
            accountNumber: string,
            resultUrl: string,
            queueTimeoutUrl: string | null = null
        ): Promise<any> {
            if (!shortCode) throw new MpesaException("Short code is required");
            if (!amount) throw new MpesaException("Amount is required");
            if (!resultUrl) throw new MpesaException("Result Url is required");
    
            const commandID: Record<string, string> = {
                'PaybillToPaybill': "BusinessPayBill",
                'PaybillToTill': "BusinessBuyGoods",
                'B2BAccountTopUp': "BusinessPayToBulk"
            };
    
            const response = await this.sendRequest("mpesa/b2b/v1/paymentrequest", {
                Initiator: this.initiatorName,
                SecurityCredential: this.securityCredential,
                CommandID: commandID[paymentType],
                SenderIdentifierType: '4',
                RecieverIdentifierType: '4',
                Amount: amount,
                PartyA: this.businessShortCode,
                PartyB: shortCode,
                AccountReference: accountNumber,
                Requester: this.requester,
                Remarks: 'OK',
                QueueTimeOutURL: queueTimeoutUrl || resultUrl,
                ResultURL: resultUrl
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.ResponseMessage || 
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async initiateB2BExpressCheckout(
            amount: number,
            receiverShortCode: string,
            callBackUrl: string,
            partnerName: string,
            paymentRef: string | null = null,
            requestRef: string | null = null
        ): Promise<any> {
            if (!amount) throw new MpesaException("Amount is required");
            if (!receiverShortCode) throw new MpesaException("Short code is required");
            if (!partnerName) throw new MpesaException("Partner Name is required");
            if (!callBackUrl) throw new MpesaException("Callback Url is required");
    
            const requestRefID = `B2B_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const paymentRefID = `PAYREFID_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
            const response = await this.sendRequest("v1/ussdpush/get-msisdn", {
                PrimaryPartyCode: this.businessShortCode,
                ReceiverPartyCode: receiverShortCode,
                Amount: amount,
                CallBackUrl: callBackUrl,
                RequestRefID: requestRef || requestRefID,
                PaymentRef: paymentRef || paymentRefID,
                PartnerName: partnerName
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
        public async mpesaRatiba(
            amount: number,
            phoneNumber: string | number,
            accountReference: string,
            startDate: string,
            endDate: string,
            standingOrderName: string,
            callBackUrl: string,
            frequency: string = "2"
        ): Promise<any> {
            if (!amount) throw new MpesaException("Amount is required");
            if (!phoneNumber) throw new MpesaException("Phone number is required");
            if (!accountReference) throw new MpesaException("Account reference is required");
            if (!callBackUrl) throw new MpesaException("Callback Url is required");
            if (!startDate) throw new MpesaException("Start Date is required");
            if (!endDate) throw new MpesaException("End Date is required");
            if (!standingOrderName) throw new MpesaException("Standing Order Name is required");
    
            const response = await this.sendRequest("mpesa/standingorders/v1/create", {
                StandingOrderName: standingOrderName,
                StartDate: startDate,
                EndDate: endDate,
                BusinessShortCode: this.businessShortCode,
                TransactionType: this.shortCodeType === "paybill" 
                    ? "Standing Order Customer Pay Bill" 
                    : "Standing Order Customer Pay Marchant",
                ReceiverPartyIdentifierType: this.shortCodeType === "paybill" ? "4" : "2",
                Amount: amount,
                PartyA: this.formatPhoneNumber(phoneNumber),
                CallBackURL: callBackUrl,
                AccountReference: accountReference,
                TransactionDesc: `Payment to ${this.businessShortCode}`,
                Frequency: frequency,
                Password: this.shortCodePassword,
                Timestamp: this.timeStamp
            });
    
            if (!response.response) {
                throw new MpesaException("No response received");
            }
    
            if (response.httpCode !== 200) {
                throw new MpesaException(
                    response.response.errorMessage || 
                    `Request failed with status ${response.httpCode}`
                );
            }
    
            return response.response;
        }
    
}