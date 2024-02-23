// Retrieve and save browser info ========================================================
var demographics_browser_info = {
    type: jsPsychBrowserCheck,
    data: {
        screen: "browser_info",
        date: new Date().toLocaleDateString("fr-FR"),
        time: new Date().toLocaleTimeString("fr-FR"),
    },
    on_finish: function () {
        data = jsPsych.data.get().filter({ screen: "browser_info" }).values()[0]
        jsPsych.data.addProperties({
            ["screen_height"]: data["height"],
            ["screen_width"]: data["width"],
        })
        for (var key in data) {
            if (
                [
                    "vsync_rate",
                    "os",
                    "mobile",
                    "browser",
                    "browser_version",
                ].includes(key)
            ) {
                jsPsych.data.addProperties({
                    [key]: data[key],
                })
            }
        }
        jsPsych.data.addProperties()
    },
}

// Participant ID ========================================================================
var demographics_participant_id = {
    type: jsPsychSurveyText,
    questions: [
        {
            prompt: "Enter participant ID:",
            placeholder: "001",
            name: "Participant_ID",
        },
    ],
    data: {
        screen: "participant_id",
    },
    on_finish: function () {
        // Store `participant_id` so that it can be reused later
        jsPsych.data.addProperties({
            participant_id: jsPsych.data.get().last().values()[0]["response"][
                "Participant_ID"
            ],
        })
    },
}

// Consent form ========================================================================
function demographics_consent(experimenter = "DEFAULT") {
    return {
        type: jsPsychHtmlButtonResponse,
        css_classes: ["narrow-text"],
        stimulus:
            // Logo and title
            "<img src='https://blogs.brighton.ac.uk/sussexwrites/files/2019/06/University-of-Sussex-logo-transparent.png' width='150px' align='right'/><br><br><br><br><br>" +
            "<h1>Informed Consent</h1>" +
            // Overview
            "<p align='left'><b>Invitation to Take Part</b><br>" +
            "You are being invited to take part in a research study to further our understanding of Human psychology. Thank you for carefully reading this information sheet. This study is being conducted by Dr Dominique Makowski and Auz Moore from the School of Psychology, University of Sussex, who are happy to be contacted (D.Makowski@sussex.ac.uk, am2351@sussex.ac.uk) if you have any questions.</p>" +
            // Description
            "<p align='left'><b>Why have I been invited and what will I do?</b><br>" +
            "We are surveying adults to develop and optimize a reaction time task, you will be asked to fill out a few demographic questions followed by two short questionnaires for psychological traits, the first being a personality trait questionnaire and the second being a four-item questionnaire to measure depression symptoms. This will be followed by two short questionaires on the average amount of time you may spend a week engaged in intense exercise and reacting to virtual stimuli. You will then be asked to run through reaction time trials. The whole experiment should last no longer than 20 minutes.</p>" +
            // Results and personal information
            "<p align='left'><b>What will happen to the results and my personal information?</b><br>" +
            "The results of this research may be written into a scientific publication. Your anonymity will be ensured in the way described in the consent information below. Please read this information carefully and then, if you wish to take part, please acknowledge that you have fully understood this sheet and that you consent to take part in the study as it is described here.</p>" +
            "<p align='left'><b>Consent</b><br></p>" +
            // Bullet points
            "<li align='left'>I understand that by signing below I am agreeing to take part in the University of Sussex research described here, and that I have read and understood this information sheet</li>" +
            "<li align='left'>I understand that my participation is entirely voluntary, that I can choose not to participate in part or all of the study, and that I can withdraw at any stage by closing the browser without having to give a reason and without being penalised in any way (e.g., if I am a student, my decision whether or not to take part will not affect my grades).</li>" +
            "<li align='left'>I understand that since the study is anonymous, it will be impossible to withdraw my data once I have completed and submitted the test/questionnaire.</li>" +
            "<li align='left'>I understand that my personal data will be used for the purposes of this research study and will be handled in accordance with Data Protection legislation. I understand that the University's Privacy Notice provides further information on how the University uses personal data in its research.</li>" +
            "<li align='left'>I understand that my collected data will be stored in a de-identified way. De-identified data may be made publically available through secured scientific online data repositories.</li>" +
            "</p>" +
            // "<p align='left'>Your participation in this research will be kept completely confidential. Your responses are entirely anonymous, and no address or any identifiers are collected.</p>" +
            // "<p align='left'><b>By participating, you agree to follow the instructions and provide honest answers.</b> If you do not wish to participate in this experiment, please inform the researcher present.</p>" +
            // "<p>Please note that various checks will be performed to ensure the validity of the data.<br>We reserve the right to return your participation or prorate reimbursement should we detect non-valid responses (e.g., random pattern of answers, instructions not read, ...).</p>"
            "<p align='left'><br><sub><sup>For further information about this research, or if you have any concerns, please contact Dr Dominique Makowski (D.Makowski@sussex.ac.uk). This research has been approved (ER/AM2351/3) by the ethics board of the School of Psychology. The University of Sussex has insurance in place to cover its legal liabilities in respect of this study.</sup></sub></p>",

        choices: ["I read, understood, and I consent"],
        data: { screen: "consent" },
        on_finish: function () {
            jsPsych.data.addProperties({
                experimenter: experimenter,
            })
        },
    }
}

// Thank you ========================================================================
var demographics_endscreen = {
    type: jsPsychHtmlButtonResponse,
    stimulus:
        "<h1>Thank you</h1>" +
        "<p>Please now complete the DogoNogo game, and then return <b> Once you have returned after the game please click continue to advance to some short questionaires</p> ",
    choices: ["Continue"],
    data: { screen: "endscreen" },
}

// Demographic info ========================================================================
var demographics_multichoice = {
    type: jsPsychSurveyMultiChoice,
    preamble: "<b>Please answer the following questions:</b>",
    questions: [
        {
            prompt: "What is your gender?",
            options: ["Male", "Female", "Other"],
            name: "gender",
        },
         {
             prompt: "How exhausted are you currently",
             options: ["Not at all", "Somewhat tired", "Very tired", "Exhausted],
             name: "exhaustion",
         },
        {
            prompt: "What is your highest level of education? Either that you have obtained or are currently enrolled in",
            options: [
                "University (doctorate)",
                "University (master) <sub><sup>or equivalent</sup></sub>",
                "University (bachelor) <sub><sup>or equivalent</sup></sub>",
                "High school",
                "Other",
            ],
            name: "education",
        },
         {
             prompt: "Have you consumed Caffeine within the last two hours?",
             options: ["Yes", "No"],
             name: "caffeine",
         },
    ],
    data: {
        screen: "demographics_1",
    },
}

var demographics_freetext = {
    type: jsPsychSurveyText,
    questions: [
        {
            prompt: "Please enter your age (in years)",
            placeholder: "e.g., '31'",
            name: "age",
        },
        {
            prompt: "Please enter your ethnicity",
            placeholder: "e.g., Caucasian",
            name: "ethnicity",
        },
        {
            prompt: "How many hours per week on average do you spend playing speed-based video games (e.g., first-person shooters, ...)?",
            placeholder: "e.g., '6'",
            name: "gaming",
        },
        {
            prompt: "How many hours per day on average do you spend on social media such as Instagram and TikTok?",
            placeholder: "e.g., '2.5'",
            name: "social",
        },
        {
            prompt: "How many hours per week on average do you spend physically exercising (e.g., running, cycling, ...)?",
            placeholder: "e.g., '1'",
            name: "sport",
        },
    ],
    data: {
        screen: "demographics_2",
    },
}

var demographics_info = {
    timeline: [demographics_multichoice, demographics_freetext],
}
