Feature: Login

  Scenario: Valid credentials log the user in
    Given the user is on the login page
    When they enter username "alice" and password "correct-horse"
    And they click the sign-in button
    Then they should see the welcome banner

  Scenario: Invalid credentials show an error
    Given the user is on the login page
    When they enter username "alice" and password "wrong-password"
    And they click the sign-in button
    Then they should see the error message "Invalid username or password"
