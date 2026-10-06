// Test provider: keeps every message in memory so tests can read the links that were "sent".
export const sentEmails = [];

export const clearSentEmails = () => {
    sentEmails.length = 0;
};

export const lastEmailTo = (address) => [...sentEmails].reverse().find((message) => message.to === address);

export const createMemoryProvider = () => ({
    name: "memory",
    async send(message) {
        sentEmails.push(message);
    },
});
