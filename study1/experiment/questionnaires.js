// Depression-Anxiety (Patient Health Questionnaire-4, PHQ-4)
var PHQ4_instructions =
    "<p><b>About your emotions...</b></p>" +
    "<p>Over the <b>last 2 weeks</b>, how often have you been bothered by the following problems?</p>"

var PHQ4_items = [
    "Feeling nervous, anxious or on edge",
    "Not being able to stop or control worrying",
    "Feeling down, depressed, or hopeless",
    "Little interest or pleasure in doing things",
]

var PHQ4_dimensions = [
    "PHQ4_Anxiety_1",
    "PHQ4_Anxiety_2",
    "PHQ4_Depression_3",
    "PHQ4_Depression_4",
]

// Mini IPIP6 questionnaire
var ipip6_items = [
    "I am the life of the party",
    "I sympathise with others' feelings",
    "I get chores done right away",
    "I have frequent mood swings",
    "I have a vivid imagination",
    "I feel entitled to more of everything",
    "I don't talk a lot",
    "I am not interested in other people's problems",
    "I have difficulty understanding abstract ideas",
    "I like order",
    "I make a mess of things",
    "I deserve more things in life",
    "I do not have a good imagination",
    "I feel others' emotions",
    "I am relaxed most of the time",
    "I get upset easily",
    "I seldom feel blue",
    "I would like to be seen driving around in a really expensive car",
    "I keep in the background",
    "I am not really interested in others",
    "I am not interested in abstract ideas",
    "I often forget to put things back in their proper place",
    "I talk to a lot of different people at parties",
    "I would get a lot of pleasure from owning expensive luxury goods",
]
var ipip6_dimensions = [
    "Extraversion_1",
    "Agreeableness_2",
    "Conscientiousness_3",
    "Neuroticism_4",
    "Openness_5",
    "HonestyHumility_6_R",
    "Extraversion_7_R",
    "Agreeableness_8_R",
    "Openness_9_R",
    "Conscientiousness_10",
    "Conscientiousness_11_R",
    "HonestyHumility_12_R",
    "Openness_13_R",
    "Agreeableness_14",
    "Neuroticism_15_R",
    "Neuroticism_16",
    "Neuroticism_17_R",
    "HonestyHumility_18_R",
    "Extraversion_19_R",
    "Agreeableness_20_R",
    "Openness_21_R",
    "Conscientiousness_22_R",
    "Extraversion_23",
    "HonestyHumility_24_R",
]

// Questionnaire ========================================================================
var PHQ4_questions = []
for (const [index, element] of PHQ4_items.entries()) {
    PHQ4_questions.push({
        prompt: "<b>" + element + "</b>",
        name: PHQ4_dimensions[index],
        labels: [
            "<br>Not at all",
            "<br>Once or twice", // New option
            "<br>Several days",
            "<br>More than half the days",
            "<br>Nearly every day",
        ],
        required: true,
    })
}

var questionnaire_phq4 = {
    type: jsPsychSurveyLikert,
    questions: PHQ4_questions,
    randomize_question_order: false,
    preamble: PHQ4_instructions,
    data: {
        screen: "questionnaire_phq4",
    },
}

// Format IPIP6 items ------------------------------------------------
function format_questions_analog(
    items,
    dimensions,
    ticks = ["Inaccurate", "Accurate"]
) {
    var questions = []
    for (const [index, element] of items.entries()) {
        questions.push({
            prompt: "<b>" + element + "</b>",
            name: dimensions[index],
            ticks: ticks,
            required: false,
            min: 0,
            max: 1,
            step: 0.01,
            slider_start: 0.5,
        })
    }
    return questions
}

// IPIP
var questionnaire_ipip6 = {
    type: jsPsychMultipleSlider,
    questions: format_questions_analog(ipip6_items, ipip6_dimensions),
    randomize_question_order: false,
    preamble:
        "<p><b>About your personality...</b></p>" +
        "<p> Please answer the following questions based on how accurately each statement describes you in general.</p>",
    require_movement: false,
    slider_width: 600,
    data: {
        screen: "questionnaire_ipip6",
    },
}


// Exercise questionnaire 
var Exercise_instructions =
    "<p><b>About your exercise habits...</b></p>" +
    

var Exercise_items = [
    "<p>Over the <b>last 2 weeks</b>, how many hours have you engaged in intense exercise or sport?</p>"
]

var Exercise_dimensions = [
    "Exercise_1"
]

var Exercise_questions = []
for (const [index, element] of Exercise_items.entries()) {
    Exercise_questions.push({
        prompt: "<b>" + element + "</b>",
        name: Exercise_dimensions[index],
        labels: [
            "<br>Not at all",
            "<br>Once or two hours", 
            "<br>Three to five hours",
            "<br>Between 6 and 8 hours",
            "<br>More than 8 hours worth",
        ],
        required: true,
    })
}

var questionnaire_exercise = {
    type: jsPsychSurveyLikert,
    questions: Exercise_questions,
    randomize_question_order: false,
    preamble: Exercise_instructions,
    data: {
        screen: "questionnaire_exercise",
    },
}

// virtual stimuli use questionaire

var virtualstim_instructions =
    "<p><b>About your online habits...</b></p>" +
    

var virtualstim_items = [
    "<p>Over the <b>last 2 weeks</b>, how many hours have you engaged in fast stimuli activity online, an example could be scrolling through tiktok or playing an fast game such as Call of Duty or CandyCrush</p>"
]

var virtualstim_dimensions = [
    "Exercise_1"
]

var virtualstim_questions = []
for (const [index, element] of virtualstim_items.entries()) {
    virtualstim_questions.push({
        prompt: "<b>" + element + "</b>",
        name: virtualstim_dimensions[index],
        labels: [
            "<br>Not at all",
            "<br>Once or two hours", 
            "<br>Three to five hours",
            "<br>Between 6 and 8 hours",
            "<br>More than 8 hours worth",
        ],
        required: true,
    })
}

var questionnaire_exercise = {
    type: jsPsychSurveyLikert,
    questions: virtualstim_questions,
    randomize_question_order: false,
    preamble: virtualstim_instructions,
    data: {
        screen: "questionnaire_virtualstim",
    },
}
