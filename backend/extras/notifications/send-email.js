import { EMAIL_FROM, SUPPORT_EMAIL } from '../../src/config/env.js';
import {
    monthlyDigestTemplate,
    dailyDigestTemplate,
    phishingAlertTemplate,
    contactMessageTemplate,
} from './email.template.js';
import welcomeTemplate from './email.template.js';
import {
    createEmailTransporter,
    getMissingEmailConfig,
} from './nodemailer.js';

const buildMissingEmailConfigResult = ({ recipient, period, generatedAt }) => {
    const missing = getMissingEmailConfig();

    if (missing.length === 0) {
        return null;
    }

    return {
        sent: false,
        recipient,
        period,
        generatedAt,
        error: {
            code: 'EMAIL_CONFIG_MISSING',
            message: 'Email delivery is not configured for this local installation.',
            missing,
        },
    };
};

const buildMissingContactEmailConfigResult = ({ recipient, generatedAt }) => {
    const missing = getMissingEmailConfig();

    if (missing.length === 0) {
        return null;
    }

    return {
        sent: false,
        recipient,
        generatedAt,
        error: {
            code: 'EMAIL_CONFIG_MISSING',
            message: 'Email delivery is not configured for this local installation.',
            missing,
        },
    };
};

export const sendWelcomeEmail = async ({ email, userName }) => {
    if (!email) {
        throw new Error('Email is required');
    }

    if (!userName) {
        throw new Error('User name is required');
    }

    const { subject, html } = welcomeTemplate(userName);

    const mailOptions = {
        from: EMAIL_FROM,
        to: email,
        subject,
        html
    };

    const missingConfig = buildMissingEmailConfigResult({
        recipient: email,
        period: null,
        generatedAt: new Date().toISOString(),
    });

    if (missingConfig) {
        throw new Error(missingConfig.error.message);
    }

    const transporter = createEmailTransporter();
    const info = await transporter.sendMail(mailOptions);

    return { success: true, messageId: info.messageId };
};

export const sendMonthlyDigestEmail = async ({ recipient, userName, summary }) => {
    if (!recipient) {
        throw new Error('Recipient email is required');
    }

    if (!summary) {
        throw new Error('Monthly summary is required');
    }

    const missingConfig = buildMissingEmailConfigResult({
        recipient,
        period: summary.period,
        generatedAt: summary.generatedAt,
    });

    if (missingConfig) {
        return missingConfig;
    }

    const { subject, html } = monthlyDigestTemplate({
        summary,
        userName: userName || recipient,
    });

    const transporter = createEmailTransporter();
    const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: recipient,
        subject,
        html,
    });

    return {
        sent: true,
        messageId: info.messageId,
        recipient,
        period: summary.period,
        generatedAt: summary.generatedAt,
    };
};

export const sendDailyDigestEmail = async ({ recipient, userName, summary }) => {
    if (!recipient) {
        throw new Error('Recipient email is required');
    }

    if (!summary) {
        throw new Error('Daily summary is required');
    }

    const missingConfig = buildMissingEmailConfigResult({
        recipient,
        period: summary.period,
        generatedAt: summary.generatedAt,
    });

    if (missingConfig) {
        return missingConfig;
    }

    const { subject, html } = dailyDigestTemplate({
        summary,
        userName: userName || recipient,
    });

    const transporter = createEmailTransporter();
    const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: recipient,
        subject,
        html,
    });

    return {
        sent: true,
        messageId: info.messageId,
        recipient,
        period: summary.period,
        generatedAt: summary.generatedAt,
    };
};

export const sendContactMessageEmail = async ({ userName, userEmail, subject, message }) => {
    const generatedAt = new Date().toISOString();
    const recipient = SUPPORT_EMAIL;
    const missingConfig = buildMissingContactEmailConfigResult({
        recipient,
        generatedAt,
    });

    if (missingConfig) {
        return missingConfig;
    }

    const safeSubject = subject || 'Support message';
    const transporter = createEmailTransporter();

    try {
        const info = await transporter.sendMail({
            from: EMAIL_FROM,
            to: SUPPORT_EMAIL,
            replyTo: userEmail,
            subject: `[Contact] ${safeSubject}`,
            text: [
                'New contact message',
                `From: ${userName} <${userEmail}>`,
                `Subject: ${safeSubject}`,
                `Generated at: ${generatedAt}`,
                '',
                message,
            ].join('\n'),
            html: contactMessageTemplate({
                userName,
                userEmail,
                subject: safeSubject,
                message,
            }),
        });

        return {
            sent: true,
            recipient: SUPPORT_EMAIL,
            messageId: info.messageId,
            generatedAt,
        };
    } catch (error) {
        return {
            sent: false,
            recipient: SUPPORT_EMAIL,
            generatedAt,
            error: {
                code: 'EMAIL_SEND_FAILED',
                message: 'Contact email could not be sent.',
                detail: error.message,
            },
        };
    }
};

export const sendPhishingAlertEmail = async ({ recipient, emails }) => {
    if (!recipient) {
        throw new Error('Recipient email is required');
    }

    const missing = getMissingEmailConfig();

    if (missing.length > 0) {
        return {
            sent: false,
            recipient,
            error: {
                code: 'EMAIL_CONFIG_MISSING',
                message: 'Email delivery is not configured for this local installation.',
                missing,
            },
        };
    }

    const { subject, html } = phishingAlertTemplate({ emails });
    const transporter = createEmailTransporter();
    const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: recipient,
        subject,
        html,
    });

    return {
        sent: true,
        messageId: info.messageId,
        recipient,
    };
};
