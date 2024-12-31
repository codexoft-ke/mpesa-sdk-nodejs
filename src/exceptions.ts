export class MpesaException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MpesaException';
    }
}