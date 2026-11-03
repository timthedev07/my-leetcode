export const PROBLEM_SEARCH_DOCUMENT = `
  query problemsetQuestionList(
    $categorySlug: String
    $limit: Int
    $skip: Int
    $filters: QuestionListFilterInput
  ) {
    problemsetQuestionList: questionList(
      categorySlug: $categorySlug
      limit: $limit
      skip: $skip
      filters: $filters
    ) {
      total: totalNum
      questions: data {
        frontendQuestionId: questionFrontendId
        title
        titleSlug
        difficulty
        paidOnly: isPaidOnly
        topicTags {
          name
          slug
        }
      }
    }
  }
`

export const QUESTION_DETAIL_DOCUMENT = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      questionFrontendId
      title
      titleSlug
      difficulty
      isPaidOnly
      content
      topicTags {
        name
        slug
      }
      hints
      codeSnippets {
        lang
        langSlug
        code
      }
      exampleTestcases
    }
  }
`

export const USER_STATUS_DOCUMENT = `
  query globalData {
    userStatus {
      isSignedIn
      username
    }
  }
`

export const USER_STATISTICS_DOCUMENT = `
  query userProfile($username: String!) {
    matchedUser(username: $username) {
      profile {
        ranking
        realName
        userAvatar
      }
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
          submissions
        }
      }
    }
  }
`

export const SUBMISSION_HISTORY_DOCUMENT = `
  query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!) {
    submissionList(
      offset: $offset
      limit: $limit
      lastKey: $lastKey
      questionSlug: $questionSlug
    ) {
      lastKey
      hasNext
      submissions {
        id
        title
        titleSlug
        status
        statusDisplay
        timestamp
        lang
        langName
        runtime
        memory
      }
    }
  }
`

export const SUBMISSION_DETAIL_DOCUMENT = `
  query submissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) {
      submissionId
      question {
        questionId
        questionFrontendId
        titleSlug
        title
      }
      code
      lang {
        name
        verboseName
      }
      statusCode
      statusDisplay
      timestamp
      runtime
      memory
      runtimeDisplay
      memoryDisplay
    }
  }
`

